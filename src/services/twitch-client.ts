import * as tmi from 'tmi.js';
import { isSharedBotAwake, sharedBotChannelAllowed } from './shared-bot-wake';
import { getStoredTokens, ensureValidToken, isTwitchAuthFailure, ProactiveTwitchRefreshGate, isTwitchCredentialQuarantined } from '../lib/token-utils.server';
import type { StoredTokens } from '../lib/token-utils.server';
import {
  listTenants,
  communityBotTokensPath,
  SPACEMOUNTAIN_SYSTEM_TENANT_ID,
  SPACEMOUNTAIN_SYSTEM_TWITCH_CHANNEL,
} from '../lib/tenant';
import { handleTwitchMessage } from './chat-dispatcher';
import { isConfirmedLoungeStellaShoutout } from './lounge-stella-shoutout-command';
import { recordSharedChatEvent } from './shared-chat-ingestion';
import { normalizeTwitchSharedChatEvent } from './shared-chat-normalizers';
import { prepareTtsOverlay, queuePreparedTtsOverlay, queueTtsOverlay } from './tts-overlay-queue';
import { promises as fsp } from 'fs';
import { getConfiguredAppUrl } from '../lib/runtime-origin';
import {
  ensureValidTheCountTwitchToken,
  readTheCountTwitchCredential,
} from '../lib/the-count-twitch-vault.server';
import { THE_COUNT_TWITCH_LOGIN } from '../lib/the-count';
import { clearSpmtServiceTokenCache, getSpmtServiceToken } from '../lib/spmt-service-token';

interface TenantClients {
  broadcasterClient: tmi.Client | null;
  botClient: tmi.Client | null;
  status: 'connected' | 'disconnected' | 'connecting';
  broadcasterUsername: string;
  botUsername: string;
  retryCount: number;
}

// Map of tenantId -> their IRC clients
const tenantClients = new Map<string, TenantClients>();

// Reverse lookup: channel name -> tenantId
const channelToTenant = new Map<string, string>();

const MAX_RETRY_ATTEMPTS = 5;
const RETRY_COOLDOWN_MS = 5 * 60 * 1000; // 5 min cooldown resets retry count
const setupInProgress = new Set<string>();
const lastRetryReset = new Map<string, number>();
let communityBotClient: tmi.Client | null = null;
let communityBotUsername = '';
const communityBotChannels = new Set<string>();
const signalCarrierChannels = new Set<string>();
let communityBotConnectPromise: Promise<tmi.Client | null> | null = null;
let theCountTwitchClient: tmi.Client | null = null;
let theCountConnectPromise: Promise<tmi.Client | null> | null = null;
const theCountChannels = new Set<string>();
const tenantsNeedingReauth = new Set<string>();
const reconnectRefreshGate = new ProactiveTwitchRefreshGate();
const lastReauthNotice = new Map<string, number>();
const REAUTH_NOTICE_INTERVAL_MS = 60_000;
const CHAT_TAG_BLACKLIST_SCOPE = 'chat-tag:blacklist:read';
const CHAT_TAG_BASE_URL = String(
  process.env.CHAT_TAG_BASE_URL
  || process.env.NEXT_PUBLIC_CHAT_TAG_URL
  || 'https://chat-tag-new.fly.dev'
).replace(/\/$/, '');
const BOT_BLACKLIST_CACHE_MS = 30_000;
let botBlacklistCache: { expiresAt: number; channels: Set<string> } | null = null;

// One chat receipt speaks once, even if multiple IRC connections see it.
const spokenLoungeStellaMessageIds = new Set<string>();
// IRC can arrive before the Helix response; defer that echo's audio to the prepared send.
const pendingLoungeStellaTexts = new Map<string, { ircMessageId?: string }>();
async function getCanonicalBotBlacklist(): Promise<Set<string>> {
  if (botBlacklistCache && botBlacklistCache.expiresAt > Date.now()) return botBlacklistCache.channels;

  let token = await getSpmtServiceToken([CHAT_TAG_BLACKLIST_SCOPE]);
  const request = (value: string) => fetch(`${CHAT_TAG_BASE_URL}/api/bot/blacklist`, {
    headers: { Accept: 'application/json', Authorization: `Bearer ${value}` },
    cache: 'no-store',
    signal: typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
      ? AbortSignal.timeout(5000)
      : undefined,
  });
  let response = await request(token);
  if (response.status === 401) {
    await response.body?.cancel().catch(() => undefined);
    clearSpmtServiceTokenCache([CHAT_TAG_BLACKLIST_SCOPE]);
    token = await getSpmtServiceToken([CHAT_TAG_BLACKLIST_SCOPE]);
    response = await request(token);
  }
  if (!response.ok) throw new Error(`ChatTag bot blacklist unavailable: ${response.status}`);

  const payload = await response.json().catch(() => null) as any;
  const channels = new Set<string>(
    (Array.isArray(payload?.blacklisted) ? payload.blacklisted : [])
      .map((value: unknown) => String(value || '').replace(/^#/, '').trim().toLowerCase())
      .filter(Boolean),
  );
  botBlacklistCache = { expiresAt: Date.now() + BOT_BLACKLIST_CACHE_MS, channels };
  return channels;
}

async function botJoinAllowed(channel: string): Promise<boolean> {
  const normalized = String(channel || '').replace(/^#/, '').trim().toLowerCase();
  if (!normalized) return false;
  const blacklist = await getCanonicalBotBlacklist();
  return !blacklist.has(normalized);
}

function spokenLoungeStellaText(message: string): string {
  // Parenthesized check-in counts, points, and levels stay visible in Twitch.
  return message.replace(/\s*\([^)]*\)/g, '').replace(/\s{2,}/g, ' ').trim();
}
function speakLoungeStellaChatMessage(channel: string, tenantId: string | undefined, tags: Record<string, any>, message: string): void {
  if (channel !== SPACEMOUNTAIN_SYSTEM_TWITCH_CHANNEL
    || tenantId !== SPACEMOUNTAIN_SYSTEM_TENANT_ID
    || String(tags.username || '').toLowerCase() !== 'stellabot87') return;
  const messageId = String(tags.id || '').trim();
  if (!messageId || spokenLoungeStellaMessageIds.has(messageId)) return;
  const pending = pendingLoungeStellaTexts.get(message);
  if (pending) { pending.ircMessageId = messageId; return; }
  spokenLoungeStellaMessageIds.add(messageId);
  if (spokenLoungeStellaMessageIds.size > 512) {
    spokenLoungeStellaMessageIds.delete(spokenLoungeStellaMessageIds.values().next().value!);
  }
  void queueTtsOverlay(spokenLoungeStellaText(message), SPACEMOUNTAIN_SYSTEM_TENANT_ID).then((result) => {
    if (!result.queued) console.warn('[Stella Lounge TTS] Chat line was not spoken:', result.error || 'not queued');
  }).catch((error) => console.error('[Stella Lounge TTS] Chat line failed:', error));
}

const STELLA_LOUNGE_LOGIN = 'stellabot87';
let loungeChatUserIds: { broadcaster: string; sender: string; expiresAt: number } | null = null;

export async function sendConfirmedLoungeStellaMessage(message: string): Promise<string> {
  const tenantId = SPACEMOUNTAIN_SYSTEM_TENANT_ID;
  // Synthesis happens before the Twitch post; the prepared audio cannot play
  // until Twitch confirms delivery. The chat highlighter has no TTS dependency.
  const spokenMessage = spokenLoungeStellaText(message);
  const preparedPromise = prepareTtsOverlay(spokenMessage, tenantId);
  const pending = { ircMessageId: undefined as string | undefined };
  pendingLoungeStellaTexts.set(message, pending);
  try {
  const clientId = process.env.TWITCH_CLIENT_ID || process.env.NEXT_PUBLIC_TWITCH_CLIENT_ID;
  const clientSecret = process.env.TWITCH_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error('Twitch client credentials are not configured');
  const tokens = await getStoredTokens(tenantId);
  if (String(tokens?.botUsername || '').toLowerCase() !== STELLA_LOUNGE_LOGIN || !tokens?.botToken) {
    throw new Error('Stella bot OAuth is unavailable for the SpaceMountain lounge');
  }
  const accessToken = (await ensureValidToken(clientId, clientSecret, 'bot', tokens, tenantId)).replace(/^oauth:/, '');
  const headers = { 'Client-Id': clientId, Authorization: `Bearer ${accessToken}` };
  let ids = loungeChatUserIds;
  if (!ids || ids.expiresAt < Date.now()) {
    const usersUrl = new URL('https://api.twitch.tv/helix/users');
    usersUrl.searchParams.append('login', SPACEMOUNTAIN_SYSTEM_TWITCH_CHANNEL);
    usersUrl.searchParams.append('login', STELLA_LOUNGE_LOGIN);
    const usersResponse = await fetch(usersUrl, { headers, signal: AbortSignal.timeout(7000) });
    if (!usersResponse.ok) throw new Error(`Twitch chat user lookup failed (${usersResponse.status})`);
    const users = await usersResponse.json() as { data?: Array<{ id: string; login: string }> };
    const broadcaster = users.data?.find(user => user.login.toLowerCase() === SPACEMOUNTAIN_SYSTEM_TWITCH_CHANNEL)?.id;
    const sender = users.data?.find(user => user.login.toLowerCase() === STELLA_LOUNGE_LOGIN)?.id;
    if (!broadcaster || !sender) throw new Error('Twitch could not resolve the lounge channel or Stella account');
    ids = { broadcaster, sender, expiresAt: Date.now() + 60 * 60_000 };
    loungeChatUserIds = ids;
  }

  const prepared = await preparedPromise;
  const response = await fetch('https://api.twitch.tv/helix/chat/messages', {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ broadcaster_id: ids.broadcaster, sender_id: ids.sender, message }),
    signal: AbortSignal.timeout(7000),
  });
  const payload = await response.json().catch(() => null) as {
    data?: Array<{ message_id?: string; is_sent?: boolean; drop_reason?: { code?: string; message?: string } | null }>;
    message?: string;
  } | null;
  const receipt = payload?.data?.[0];
  if (!response.ok || receipt?.is_sent !== true || !receipt.message_id) {
    const reason = receipt?.drop_reason?.message || receipt?.drop_reason?.code || payload?.message || `HTTP ${response.status}`;
    throw new Error(`Twitch did not send Stella's lounge chat message: ${reason}`);
  }
  const messageId = receipt.message_id;
  if (!spokenLoungeStellaMessageIds.has(messageId)) {
    spokenLoungeStellaMessageIds.add(messageId);
    if (spokenLoungeStellaMessageIds.size > 512) {
      spokenLoungeStellaMessageIds.delete(spokenLoungeStellaMessageIds.values().next().value!);
    }
    // Queue immediately after Twitch accepts; do not wait for IRC or the highlighter.
    if (prepared.audioUrl) {
      void queuePreparedTtsOverlay(spokenMessage, prepared.audioUrl, tenantId).then(result => {
        if (!result.queued) console.warn('[Stella Lounge TTS] Confirmed line could not play:', messageId, result.error);
      });
    } else console.warn('[Stella Lounge TTS] Confirmed line has no audio:', messageId, prepared.result.error);
  }
  return messageId;
  } catch (error) {
    // An IRC receipt proves the chat arrived even if the Helix response timed out.
    if (pending.ircMessageId) {
      const prepared = await preparedPromise;
      spokenLoungeStellaMessageIds.add(pending.ircMessageId);
      if (prepared.audioUrl) {
        void queuePreparedTtsOverlay(spokenMessage, prepared.audioUrl, tenantId).then(result => {
          if (!result.queued) console.warn('[Stella Lounge TTS] IRC-received line could not play:', pending.ircMessageId, result.error);
        });
      }
      return pending.ircMessageId;
    }
    throw error;
  } finally {
    if (pendingLoungeStellaTexts.get(message) === pending) pendingLoungeStellaTexts.delete(message);
  }
}

export type TwitchSendIdentity = 'bot' | 'broadcaster' | 'count';

export function resolveOutboundTwitchRoute(input: {
  tenantId?: string;
  channel?: string;
  as?: TwitchSendIdentity;
}): {
  tenantId?: string;
  channel: string;
  clientType: 'bot' | 'broadcaster';
  sendAs: TwitchSendIdentity;
  systemTranslated: boolean;
} {
  const requestedIdentity: TwitchSendIdentity = input.as || 'bot';
  const requestedTenantId = String(input.tenantId || '').trim().toLowerCase();
  const requestedChannel = String(input.channel || '').trim().replace(/^#/, '').toLowerCase();
  const isSystemTenant =
    requestedTenantId === SPACEMOUNTAIN_SYSTEM_TENANT_ID
    || requestedChannel === SPACEMOUNTAIN_SYSTEM_TWITCH_CHANNEL;

  if (isSystemTenant && requestedIdentity !== 'count') {
    return {
      tenantId: SPACEMOUNTAIN_SYSTEM_TENANT_ID,
      channel: SPACEMOUNTAIN_SYSTEM_TWITCH_CHANNEL,
      clientType: requestedIdentity === 'broadcaster' ? 'broadcaster' : 'bot',
      sendAs: requestedIdentity,
      systemTranslated: false,
    };
  }

  return {
    tenantId: requestedTenantId || undefined,
    channel: requestedChannel,
    clientType: requestedIdentity === 'broadcaster' ? 'broadcaster' : 'bot',
    sendAs: requestedIdentity,
    systemTranslated: false,
  };
}

async function dispatchIncomingTwitchMessage(
  channel: string,
  tags: Record<string, any>,
  message: string,
  self: boolean,
  fallbackTenantId?: string,
): Promise<void> {
  const channelName = channel.replace('#', '').toLowerCase();
  const msgTenantId = channelToTenant.get(channelName) || fallbackTenantId;
  // tmi.js emits a local "self" message before Twitch accepts the write.
  // Do not treat that echo as a received chat message in this lounge.
  if (self && msgTenantId === SPACEMOUNTAIN_SYSTEM_TENANT_ID
    && channelName === SPACEMOUNTAIN_SYSTEM_TWITCH_CHANNEL
    && !isConfirmedLoungeStellaShoutout({ tenantId: msgTenantId, channel: channelName, tags, message })) return;

  const { isMirroredSharedMessage, resolveRoomIdToLogin, shouldIgnoreMirrored } = await import('./shared-chat');
  if (shouldIgnoreMirrored(tags, msgTenantId)) return;

  let effectiveChannel = channel;
  const isMirrored = isMirroredSharedMessage(tags);

  // The IRC listener already knows the tenant for direct channel traffic. If the
  // reverse map is missing or stale, heal it before chat-dispatcher tries to
  // resolve the tenant again. Never learn mappings from mirrored shared-chat
  // traffic because its effective source channel may belong to another tenant.
  if (!isMirrored && msgTenantId && !channelToTenant.has(channelName)) {
    channelToTenant.set(channelName, msgTenantId);
    console.warn(`[Twitch:${msgTenantId}] Healed missing channel tenant mapping for #${channelName} from listener context.`);
  }

  if (isMirrored) {
    const sourceRoomId = tags['source-room-id'] || tags['source-id'];
    effectiveChannel = '#' + await resolveRoomIdToLogin(sourceRoomId, channelName);
  }

  if (typeof (global as any).broadcast === 'function') {
    (global as any).broadcast({
      type: 'twitch-message',
      payload: {
        id: tags.id || Date.now().toString(),
        user: tags.username,
        message,
        color: tags.color,
        badges: tags.badges,
        emotes: tags.emotes,
        isMirrored,
        sourceChannel: isMirrored ? effectiveChannel.replace('#', '') : undefined,
        tenantId: msgTenantId,
      },
    }, msgTenantId);
  }

  if (msgTenantId) {
    try {
      await recordSharedChatEvent(normalizeTwitchSharedChatEvent({
        tenantId: msgTenantId,
        channel: effectiveChannel,
        tags,
        message,
        self,
      }));
    } catch (error) {
      console.warn('[SharedChat] Twitch ingestion failed:', error instanceof Error ? error.message : String(error));
    }
  }

  speakLoungeStellaChatMessage(channelName, msgTenantId, tags, message);
  await handleTwitchMessage(effectiveChannel, tags, message, self);
}

export function isSharedCommunityBotClient(client: tmi.Client | null): boolean {
  return Boolean(client && communityBotClient && client === communityBotClient);
}

export function isCommunityBotOwnChannel(client: tmi.Client | null, channel: string): boolean {
  return isSharedCommunityBotClient(client)
    && Boolean(communityBotUsername)
    && channel.replace(/^#/, '').trim().toLowerCase() === communityBotUsername;
}


/** Shared transport can speak only in its own channel or an opted-in tenant's exact channel. */
export async function canSharedCommunityBotSpeak(client: tmi.Client | null, channel: string, tenantId?: string): Promise<boolean> {
  if (!isSharedCommunityBotClient(client)) return true;
  const normalized = channel.replace(/^#/, '').trim().toLowerCase();
  const allowed = sharedBotChannelAllowed({
    channel: normalized, communityBotLogin: communityBotUsername, tenantId,
    registeredChannel: tenantId ? tenantClients.get(tenantId)?.broadcasterUsername : undefined,
    mappedTenantId: channelToTenant.get(normalized), awake: isSharedBotAwake(tenantId),
  });
  return allowed && await botJoinAllowed(normalized).catch(() => false);
}

/** Bounded owner/mod control receipt; permitted even when wake is off.
 * Only the verified Twitch dispatcher calls this, never an HTTP payload.
 */
export async function acknowledgeBotWakeCommand(tenantId: string): Promise<void> {
  let tenant = tenantClients.get(tenantId);
  if (!tenant?.broadcasterUsername) throw new Error('Registered channel not connected');
  if (!isClientUsable(tenant.botClient)) {
    await setupTwitchClient(tenantId);
    tenant = tenantClients.get(tenantId);
  }
  const client = tenant?.botClient;
  const channel = tenant?.broadcasterUsername.replace(/^#/, '').toLowerCase() || '';
  if (!client || !isClientUsable(client) || channelToTenant.get(channel) !== tenantId
    || !await botJoinAllowed(channel)) throw new Error('Bot transport unavailable or channel excluded');
  const shared = isSharedCommunityBotClient(client);
  const mode = isSharedBotAwake(tenantId) ? 'ON' : 'OFF';
  const identity = String(client.getUsername?.() || tenant?.botUsername || 'bot');
  const message = shared
    ? 'StreamWeaver wake ' + mode + ' for #' + channel + '. ' + (mode === 'ON'
      ? 'The shared bot uses this channel’s saved persona; mention @' + identity + ' to talk.'
      : 'Shared bot replies are asleep. Broadcaster/mod: spmt wake on.')
    : 'StreamWeaver wake ' + mode + ' for #' + channel + '. Personal bot @' + identity
      + ' stays in charge; wake controls only the shared fallback.';
  const { sendWithSharedChatAwareness } = await import('./shared-chat');
  await sendWithSharedChatAwareness({ client, channel, message, as: 'bot', tenantId });
}

function isClientUsable(client: tmi.Client | null | undefined): client is tmi.Client {
  if (!client) return false;
  try {
    const state = typeof (client as any).readyState === 'function' ? (client as any).readyState() : null;
    return !state || state === 'OPEN';
  } catch {
    return true;
  }
}

export function shouldDispatchIncomingFromCommunityBot(broadcasterClient: tmi.Client | null | undefined): boolean {
  return !isClientUsable(broadcasterClient);
}

function isAuthFailure(error: unknown): boolean {
  return isTwitchAuthFailure(error);
}

async function getTokenIdentity(accessToken: string): Promise<{ userId: string; login: string } | null> {
  try {
    const response = await fetch('https://id.twitch.tv/oauth2/validate', {
      headers: { Authorization: `OAuth ${accessToken.replace('oauth:', '')}` },
    });
    if (!response.ok) return null;
    const data = await response.json();
    return {
      userId: String(data.user_id || ''),
      login: String(data.login || ''),
    };
  } catch {
    return null;
  }
}

async function disconnectIfOpen(client: tmi.Client | null | undefined): Promise<void> {
  if (!client) return;
  try {
    const state = typeof (client as any).readyState === 'function' ? (client as any).readyState() : null;
    if (state && state !== 'OPEN') return;
    await client.disconnect();
  } catch (error) {
    if (!/socket is not opened|already closing|cannot disconnect/i.test(String(error))) {
      throw error;
    }
  }
}

async function getCommunityBotTokens(): Promise<StoredTokens | null> {
  const tokenPath = communityBotTokensPath();
  try {
    const raw = await fsp.readFile(tokenPath, 'utf-8');
    const parsed = JSON.parse(raw);
    const normalized: StoredTokens = {
      communityBotToken: parsed.communityBotToken || parsed.botToken || parsed.access_token,
      communityBotRefreshToken: parsed.communityBotRefreshToken || parsed.botRefreshToken || parsed.refresh_token,
      communityBotUsername: parsed.communityBotUsername || parsed.botUsername || parsed.username,
      communityBotTokenExpiry: parsed.communityBotTokenExpiry || parsed.botTokenExpiry,
    };
    const missing = [
      !normalized.communityBotToken ? 'access token' : '',
      !normalized.communityBotRefreshToken ? 'refresh token' : '',
      !normalized.communityBotUsername ? 'username' : '',
    ].filter(Boolean);
    if (missing.length > 0) {
      console.warn(`[Twitch:community-bot] Credentials incomplete at ${tokenPath}: missing ${missing.join(', ')}`);
      return null;
    }
    return normalized;
  } catch (error: any) {
    const code = String(error?.code || '');
    if (code === 'ENOENT') {
      console.warn(`[Twitch:community-bot] Credential file not found at ${tokenPath}; authorize the Community Bot in Integrations`);
    } else {
      console.warn(`[Twitch:community-bot] Could not read credentials at ${tokenPath}: ${error?.message || String(error)}`);
    }
    return null;
  }
}

async function ensureCommunityBotForChannel(
  channel: string,
  clientId: string,
  clientSecret: string
): Promise<tmi.Client | null> {
  if (!channel) return null;

  if (!communityBotConnectPromise) {
    communityBotConnectPromise = (async () => {
      const communityTokens = await getCommunityBotTokens();
      if (!communityTokens) {
        return null;
      }

      communityBotUsername = String(communityTokens.communityBotUsername || '').toLowerCase();
      if (!communityBotUsername) return null;

      const oauth = await ensureValidToken(clientId, clientSecret, 'community-bot', communityTokens);
      const client = new tmi.Client({
        options: { debug: false },
        identity: {
          username: communityBotUsername,
          password: `oauth:${oauth.replace('oauth:', '')}`,
        },
        channels: [],
      });

      client.on('connected', () => {
        console.log(`[Twitch:community-bot] Connected as ${communityBotUsername}`);
      });
      client.on('disconnected', (reason) => {
        console.log(`[Twitch:community-bot] Disconnected: ${reason}`);
        communityBotClient = null;
        communityBotConnectPromise = null;
        communityBotChannels.clear();
      });
      client.on('message', async (channel, tags, message, self) => {
        try {
          const channelName = channel.replace('#', '').toLowerCase();
          const tenantId = channelToTenant.get(channelName);
          const isSignalCarrier = signalCarrierChannels.has(channelName);
          if (!tenantId && !isSignalCarrier) return;
          const tenant = tenantId ? tenantClients.get(tenantId) : undefined;
          if (
            tenant
            && (
              !shouldDispatchIncomingFromCommunityBot(tenant.broadcasterClient)
              || (tenantId === SPACEMOUNTAIN_SYSTEM_TENANT_ID
                && isClientUsable(tenant.botClient)
                && !isSharedCommunityBotClient(tenant.botClient))
            )
          ) {
            return;
          }

          if (!tenantId && isSignalCarrier) {
            if (self) return;
            const username = String(tags?.username || tags?.['display-name'] || 'viewer').trim();
            const carrierMessage = String(message || '');
            // Carrier chats are read-only for StreamWeaverBot. The Signal
            // action may still run, but acknowledgements stay out of chat.
            const sayCarrierReply = async (_text: string): Promise<boolean> => false;

            if (/^!signal(?:\s|$)/i.test(carrierMessage)) {
              const { handleTwitchSignalCommand } = await import('./signal-system');
              try {
                const result = await handleTwitchSignalCommand({
                  providerUserId: String(tags?.['user-id'] || ''),
                  username,
                  broadcaster: channelName,
                  rawMessage: carrierMessage,
                  deferAcknowledgement: true,
                });
                if (result.message) {
                  await sayCarrierReply(result.message);
                }
              } catch (error: any) {
                console.error('[Twitch:community-bot] Carrier !signal failed:', error);
                await sayCarrierReply(`@${username}, Signal failed: ${error?.message || 'unknown error'}`);
              }
              return;
            }

            return;
          }

          await dispatchIncomingTwitchMessage(channel, tags, message, self, tenantId);
        } catch (error) {
          console.error('[Twitch:community-bot] Message handler failed:', error);
          return;
        }
      });

      await client.connect();
      communityBotClient = client;
      return client;
    })().catch((error) => {
      console.error('[Twitch:community-bot] Setup failed:', error);
      communityBotClient = null;
      communityBotConnectPromise = null;
      return null;
    });
  }

  const client = await communityBotConnectPromise;
  if (!client) {
    // Do not cache a failed setup forever: OAuth can write fresh credentials while this process is live.
    communityBotConnectPromise = null;
    return null;
  }

  const channelLogin = String(channel || '').trim().replace(/^#+/, '').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 25);
  if (!channelLogin) return null;
  try {
    if (!await botJoinAllowed(channelLogin)) {
      console.log(`[Twitch:community-bot] Skipping blacklisted #${channelLogin}`);
      return null;
    }
  } catch (error) {
    console.warn(`[Twitch:community-bot] Refusing join while canonical blacklist is unavailable for #${channelLogin}:`, error);
    return null;
  }
  if (!communityBotChannels.has(channelLogin)) {
    try {
      await client.join(channelLogin);
      communityBotChannels.add(channelLogin);
      console.log(`[Twitch:community-bot] Joined #${channelLogin}`);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error(`[Twitch:community-bot] Failed to join carrier ${channelLogin}: ${detail}`);
    }
  }

  return client;
}

async function getOrConnectTheCountTwitchClient(
  clientId: string,
  clientSecret: string,
): Promise<tmi.Client | null> {
  if (!theCountConnectPromise) {
    theCountConnectPromise = (async () => {
      const credential = await readTheCountTwitchCredential();
      if (!credential) return null;
      if (credential.login !== THE_COUNT_TWITCH_LOGIN) {
        throw new Error('The Count Twitch vault contains the wrong login');
      }

      const oauth = await ensureValidTheCountTwitchToken(clientId, clientSecret);
      const client = new tmi.Client({
        options: { debug: false },
        identity: {
          username: THE_COUNT_TWITCH_LOGIN,
          password: `oauth:${oauth.replace(/^oauth:/, '')}`,
        },
        channels: [],
      });

      client.on('connected', () => {
        console.log(`[Twitch:the-count] Connected as ${THE_COUNT_TWITCH_LOGIN}`);
      });
      client.on('disconnected', (reason) => {
        console.log(`[Twitch:the-count] Disconnected: ${reason}`);
        theCountTwitchClient = null;
        theCountConnectPromise = null;
        theCountChannels.clear();
      });

      // Incoming chat is already handled by each tenant's broadcaster or shared
      // listener. The Count client is send-only so it cannot duplicate dispatch.
      await client.connect();
      theCountTwitchClient = client;
      return client;
    })().catch((error) => {
      console.error('[Twitch:the-count] Setup failed:', error);
      theCountTwitchClient = null;
      theCountConnectPromise = null;
      return null;
    });
  }

  return theCountConnectPromise;
}

async function ensureTheCountForChannel(
  channel: string,
  clientId: string,
  clientSecret: string,
): Promise<tmi.Client | null> {
  const normalizedChannel = String(channel || '').replace(/^#/, '').trim().toLowerCase();
  if (!normalizedChannel) return null;
  try {
    if (!await botJoinAllowed(normalizedChannel)) {
      console.log(`[Twitch:the-count] Skipping blacklisted #${normalizedChannel}`);
      return null;
    }
  } catch (error) {
    console.warn(`[Twitch:the-count] Refusing join while canonical blacklist is unavailable for #${normalizedChannel}:`, error);
    return null;
  }

  const client = await getOrConnectTheCountTwitchClient(clientId, clientSecret);
  if (!client) return null;

  if (!theCountChannels.has(normalizedChannel)) {
    try {
      await client.join(normalizedChannel);
      theCountChannels.add(normalizedChannel);
      console.log(`[Twitch:the-count] Joined #${normalizedChannel}`);
    } catch (error) {
      console.error(`[Twitch:the-count] Failed to join #${normalizedChannel}:`, error);
    }
  }

  return client;
}

export async function setupTheCountTwitchClient(): Promise<tmi.Client | null> {
  const clientId = process.env.TWITCH_CLIENT_ID || process.env.NEXT_PUBLIC_TWITCH_CLIENT_ID;
  const clientSecret = process.env.TWITCH_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  const channels = Array.from(new Set(
    Array.from(tenantClients.values())
      .map((tenant) => tenant.broadcasterUsername.replace(/^#/, '').trim().toLowerCase())
      .filter(Boolean),
  ));

  let client = await getOrConnectTheCountTwitchClient(clientId, clientSecret);
  for (const channel of channels) {
    client = await ensureTheCountForChannel(channel, clientId, clientSecret) || client;
  }
  return client;
}

export async function reconnectTheCountTwitchClient(): Promise<tmi.Client | null> {
  if (theCountTwitchClient) {
    try {
      theCountTwitchClient.removeAllListeners();
      await disconnectIfOpen(theCountTwitchClient);
    } catch (error) {
      console.warn('[Twitch:the-count] Reconnect cleanup warning:', error);
    }
  }
  theCountTwitchClient = null;
  theCountConnectPromise = null;
  theCountChannels.clear();
  return setupTheCountTwitchClient();
}

function normalizeSignalCarrierChannel(value: string): string {
  return String(value || '').replace(/^#/, '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 25);
}

export async function syncSignalCarrierChannels(channels: string[]): Promise<{ active: string[]; joined: string[]; parted: string[] }> {
  const clientId = process.env.TWITCH_CLIENT_ID;
  const clientSecret = process.env.TWITCH_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error('Twitch client credentials are not configured');

  const next = new Set((channels || []).map(normalizeSignalCarrierChannel).filter(Boolean));
  const joined: string[] = [];
  const parted: string[] = [];

  for (const channel of next) {
    if (!communityBotChannels.has(channel)) {
      const client = await ensureCommunityBotForChannel(channel, clientId, clientSecret);
      if (!client || !communityBotChannels.has(channel)) {
        console.warn(`[Signal] Skipping carrier ${channel}: community bot could not join; continuing with remaining live carriers`);
        continue;
      }
      joined.push(channel);
    }
    signalCarrierChannels.add(channel);
  }

  for (const channel of [...signalCarrierChannels]) {
    if (next.has(channel)) continue;
    signalCarrierChannels.delete(channel);
    if (channelToTenant.has(channel)) continue;
    if (communityBotClient && communityBotChannels.has(channel)) {
      try {
        await communityBotClient.part(channel);
      } catch (error) {
        console.warn(`[Twitch:community-bot] Failed to part removed Signal carrier #${channel}:`, error);
      }
      communityBotChannels.delete(channel);
      parted.push(channel);
    }
  }

  return { active: [...signalCarrierChannels].sort(), joined, parted };
}

async function sendReauthNotice(client: tmi.Client, channel: string, tenantId: string, username?: string): Promise<void> {
  if (!await canSharedCommunityBotSpeak(client, channel, tenantId)) return;
  const key = `${tenantId}:${String(username || 'chat').toLowerCase()}`;
  const now = Date.now();
  if (now - (lastReauthNotice.get(key) || 0) < REAUTH_NOTICE_INTERVAL_MS) return;
  lastReauthNotice.set(key, now);
  const mention = username ? `@${username}, ` : '';
  const appUrl = getConfiguredAppUrl();
  await client.say(channel, `${mention}StreamWeaver needs the streamer to re-authorize Twitch before commands can run. Re-authorize here: ${appUrl}/integrations`);
}

async function sendMessageWithClient(client: tmi.Client, channel: string, message: string): Promise<boolean> {
  if (!await canSharedCommunityBotSpeak(client, channel, channelToTenant.get(channel.replace(/^#/, '').toLowerCase()))) return false;
  try {
    const channelLogin = channel.replace(/^#/, '').toLowerCase();
    try {
      await client.join(channelLogin);
    } catch {
      // Best effort. If already joined or join races, say() may still work.
    }
    await client.say(channelLogin, message);
    return true;
  } catch {
    return false;
  }
}

async function tryDeliverReauthNotice(tenantId: string, channel: string): Promise<void> {
  const normalizedChannel = channel.replace(/^#/, '').toLowerCase();
  const key = `${tenantId}:startup`;
  const now = Date.now();
  if (now - (lastReauthNotice.get(key) || 0) < REAUTH_NOTICE_INTERVAL_MS) return;

  const appUrl = getConfiguredAppUrl();
  const message = `StreamWeaver needs the streamer to re-authorize Twitch before commands can run. Re-authorize here: ${appUrl}/integrations`;
  const tenant = tenantClients.get(tenantId);

  if (tenant?.botClient && await sendMessageWithClient(tenant.botClient, normalizedChannel, message)) {
    lastReauthNotice.set(key, now);
    return;
  }

  if (tenant?.broadcasterClient && await sendMessageWithClient(tenant.broadcasterClient, normalizedChannel, message)) {
    lastReauthNotice.set(key, now);
    return;
  }

  const clientId = process.env.TWITCH_CLIENT_ID;
  const clientSecret = process.env.TWITCH_CLIENT_SECRET;
  if (clientId && clientSecret) {
    const sharedBot = await ensureCommunityBotForChannel(normalizedChannel, clientId, clientSecret);
    if (sharedBot && await sendMessageWithClient(sharedBot, normalizedChannel, message)) {
      lastReauthNotice.set(key, now);
      return;
    }
  }

  // Never borrow the owner's credentials for a different channel's reauth
  // notice. If this tenant and the read-only community listener cannot send,
  // retry when its own bot is available instead.
  console.warn(`[Twitch:${tenantId}] Reauth notice could not be sent to #${normalizedChannel} with tenant credentials`);
}

function scheduleRetry(tenantId: string) {
  if (setupInProgress.has(tenantId)) return;
  const tenant = tenantClients.get(tenantId);
  if (tenant && tenant.retryCount >= MAX_RETRY_ATTEMPTS) {
    const lastReset = lastRetryReset.get(tenantId) || 0;
    if (Date.now() - lastReset > RETRY_COOLDOWN_MS) {
      console.log(`[Twitch:${tenantId}] Cooldown elapsed, resetting retry count.`);
      tenant.retryCount = 0;
      lastRetryReset.set(tenantId, Date.now());
    } else {
      console.log(`[Twitch:${tenantId}] Max retries reached, waiting for cooldown.`);
      return;
    }
  }
  const delay = Math.min(5000 * Math.pow(2, tenant?.retryCount || 0), 60000);
  console.log(`[Twitch:${tenantId}] Will retry in ${delay / 1000}s...`);
  setTimeout(() => {
    setupTwitchClient(tenantId).catch(e =>
      console.error(`[Twitch:${tenantId}] Retry failed:`, e)
    );
  }, delay);
}

export async function setupTwitchClient(tenantId: string) {
  if (setupInProgress.has(tenantId)) {
    console.log(`[Twitch:${tenantId}] Setup already in progress, skipping.`);
    return;
  }

  setupInProgress.add(tenantId);
  console.log(`[Twitch:${tenantId}] Starting chat client setup...`);

  const clientId = process.env.TWITCH_CLIENT_ID;
  const clientSecret = process.env.TWITCH_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.error(`[Twitch:${tenantId}] Client credentials not configured.`);
    setupInProgress.delete(tenantId);
    return;
  }

  // SpaceMountainLive is intentionally a system tenant, not a normal
  // broadcaster-authenticated tenant. Stella's dedicated bot OAuth owns
  // StreamWeaver chat/listening. Broadcaster-style sends are delegated to
  // ChatTag, which owns the spacemountainlive credential.
  if (tenantId === SPACEMOUNTAIN_SYSTEM_TENANT_ID) {
    try {
      const channel = SPACEMOUNTAIN_SYSTEM_TWITCH_CHANNEL;
      channelToTenant.set(channel, tenantId);
      const tenant: TenantClients = tenantClients.get(tenantId) || {
        broadcasterClient: null,
        botClient: null,
        status: 'connecting',
        broadcasterUsername: channel,
        botUsername: '',
        retryCount: 0,
      };

      if (tenant.botClient && !isSharedCommunityBotClient(tenant.botClient)) {
        try {
          tenant.botClient.removeAllListeners();
          await disconnectIfOpen(tenant.botClient);
        } catch {}
      }

      tenant.broadcasterUsername = channel;
      tenant.broadcasterClient = null;
      tenant.botClient = null;
      tenant.status = 'connecting';
      tenantClients.set(tenantId, tenant);

      const tokens = await getStoredTokens(tenantId);
      const dedicatedBotUsername = String(tokens?.botUsername || '').trim().toLowerCase();
      const hasDedicatedBot = Boolean(
        dedicatedBotUsername
        && tokens?.botToken
        && tokens?.botRefreshToken
      );

      if (hasDedicatedBot) {
        try {
          const botOauthToken = await ensureValidToken(clientId, clientSecret, 'bot', tokens!, tenantId);
          const dedicatedBot = new tmi.Client({
            options: { debug: false },
            identity: {
              username: dedicatedBotUsername,
              password: `oauth:${botOauthToken.replace(/^oauth:/, '')}`,
            },
            channels: [channel],
          });

          dedicatedBot.on('connected', () => {
            tenant.status = 'connected';
            tenant.retryCount = 0;
            console.log(`[Twitch:spacemountainlive] Stella connected as ${dedicatedBotUsername}`);
          });

          dedicatedBot.on('message', async (incomingChannel, tags, message, self) => {
            if (incomingChannel.replace(/^#/, '').toLowerCase() !== channel) return;
            await dispatchIncomingTwitchMessage(incomingChannel, tags, message, self, tenantId);
          });

          dedicatedBot.on('disconnected', (reason) => {
            console.log(`[Twitch:spacemountainlive] Stella disconnected: ${reason}`);
            if (tenant.botClient === dedicatedBot) tenant.botClient = null;
            tenant.status = 'disconnected';
            tenant.retryCount++;
            if (!isAuthFailure(reason)) scheduleRetry(tenantId);
          });

          await dedicatedBot.connect();
          tenant.botClient = dedicatedBot;
          tenant.botUsername = dedicatedBotUsername;
          tenantsNeedingReauth.delete(tenantId);
          reconnectRefreshGate.markSuccessful(tenantId);
          console.log(`[Twitch:spacemountainlive] System tenant listening in #${channel} through Stella (${dedicatedBotUsername})`);
          return;
        } catch (error) {
          console.warn('[Twitch:spacemountainlive] Stella bot unavailable; system tenant remains disconnected:', error);
          tenant.botClient = null;
        }
      }

      tenant.status = 'disconnected';
      tenant.botUsername = dedicatedBotUsername;
      console.warn('[Twitch:spacemountainlive] No Stella bot connection is available; refusing community-bot fallback.');
      return;
    } finally {
      setupInProgress.delete(tenantId);
    }
  }

  let attemptedTokens: StoredTokens | null = null;
  try {
    const tokens = await getStoredTokens(tenantId);
    attemptedTokens = tokens;
    // Keep registered channel routing available even when Twitch rejects a
    // broadcaster refresh. Shared-bot commands use the bot's own credential.
    if (tokens?.broadcasterUsername && !tenantClients.has(tenantId)) {
      channelToTenant.set(tokens.broadcasterUsername.toLowerCase(), tenantId);
      tenantClients.set(tenantId, {
        broadcasterClient: null, botClient: null, status: 'disconnected',
        broadcasterUsername: tokens.broadcasterUsername, botUsername: tokens.botUsername || '', retryCount: 0,
      });
    }
    if ((!tokens?.broadcasterToken && !tokens?.broadcasterRefreshToken) || isTwitchCredentialQuarantined(tokens, 'broadcaster')) {
      console.info(`[Twitch:${tenantId}] Broadcaster integration awaiting authorization; bot chat uses its own credential.`);
      if (tokens?.broadcasterUsername) {
        channelToTenant.set(tokens.broadcasterUsername.toLowerCase(), tenantId);
        void ensureTheCountForChannel(tokens.broadcasterUsername, clientId, clientSecret);
        tenantsNeedingReauth.add(tenantId);
        reconnectRefreshGate.markReauthorizationRequired(tenantId, tokens);
        const tenant = tenantClients.get(tenantId) || {
          broadcasterClient: null,
          botClient: null,
          status: 'disconnected' as const,
          broadcasterUsername: tokens.broadcasterUsername,
          botUsername: tokens.botUsername || '',
          retryCount: 0,
        };
        tenantClients.set(tenantId, tenant);
        const sharedBot = await ensureCommunityBotForChannel(tokens.broadcasterUsername, clientId, clientSecret);
        if (sharedBot) {
          tenant.botClient = sharedBot;
          tenant.botUsername = communityBotUsername || 'community-bot';
        }
        await tryDeliverReauthNotice(tenantId, tokens.broadcasterUsername);
      }
      setupInProgress.delete(tenantId);
      return;
    }

    const broadcasterOauthToken = await ensureValidToken(clientId, clientSecret, 'broadcaster', tokens, tenantId);
    const broadcasterIdentity = await getTokenIdentity(broadcasterOauthToken);
    let broadcasterTokenMismatch = false;
    if (broadcasterIdentity?.userId && broadcasterIdentity.userId !== String(tenantId)) {
      console.error(
        `[Twitch:${tenantId}] Broadcaster token belongs to ${broadcasterIdentity.login || broadcasterIdentity.userId}; refusing to connect as the wrong account.`
      );
      tenantsNeedingReauth.add(tenantId);
      reconnectRefreshGate.markReauthorizationRequired(tenantId, tokens);
      broadcasterTokenMismatch = true;
    }

    const broadcasterUsername = broadcasterTokenMismatch
      ? (tokens.loginUsername || '')
      : (broadcasterIdentity?.login || tokens.broadcasterUsername || tokens.loginUsername || '');
    const botUsername = tokens.botUsername || '';
    const hasBotToken = tokens.botToken || tokens.botRefreshToken;

    console.log(`[Twitch:${tenantId}] Broadcaster: ${broadcasterUsername}, Bot: ${botUsername || 'none'}`);

    if (broadcasterUsername) {
      channelToTenant.set(broadcasterUsername.toLowerCase(), tenantId);
      void ensureTheCountForChannel(broadcasterUsername, clientId, clientSecret);
      const existingTenant = tenantClients.get(tenantId);
      if (!existingTenant) {
        tenantClients.set(tenantId, {
          broadcasterClient: null,
          botClient: null,
          status: 'connecting',
          broadcasterUsername,
          botUsername,
          retryCount: 0,
        });
      }
    }

    if (!broadcasterTokenMismatch) {
      tenantsNeedingReauth.delete(tenantId);
      reconnectRefreshGate.markSuccessful(tenantId);
    }

    // Disconnect existing clients for this tenant
    const existing = tenantClients.get(tenantId);
    if (existing) {
      if (existing.botClient) {
        if (!isSharedCommunityBotClient(existing.botClient)) {
          try { existing.botClient.removeAllListeners(); await disconnectIfOpen(existing.botClient); } catch {}
        }
      }
      if (existing.broadcasterClient) {
        try { existing.broadcasterClient.removeAllListeners(); await disconnectIfOpen(existing.broadcasterClient); } catch {}
      }
    }

    const tenant: TenantClients = {
      broadcasterClient: null,
      botClient: null,
      status: 'connecting',
      broadcasterUsername,
      botUsername,
      retryCount: existing?.retryCount || 0,
    };
    tenantClients.set(tenantId, tenant);
    if (broadcasterUsername) {
      channelToTenant.set(broadcasterUsername.toLowerCase(), tenantId);
    }

    // An optional personal bot failure must not disable the broadcaster.
    try {
      // Setup bot client
      if (botUsername && hasBotToken) {
        console.log(`[Twitch:${tenantId}] Connecting bot as '${botUsername}'...`);
        const botOauthToken = await ensureValidToken(clientId, clientSecret, 'bot', tokens, tenantId);

        tenant.botClient = new tmi.Client({
          options: { debug: false },
          identity: {
            username: botUsername,
            password: `oauth:${botOauthToken.replace('oauth:', '')}`,
          },
          channels: [broadcasterUsername],
        });

        tenant.botClient.on('connected', () => {
          console.log(`[Twitch:${tenantId}] Bot connected as ${botUsername}`);
          if (broadcasterTokenMismatch) {
            tenant.status = 'connected';
          }
        });

        tenant.botClient.on('disconnected', (reason) => {
          console.log(`[Twitch:${tenantId}] Bot disconnected: ${reason}`);
          if (tenant.botClient && !isSharedCommunityBotClient(tenant.botClient)) {
            tenant.botClient = null;
          }
          if (!isClientUsable(tenant.broadcasterClient)) {
            tenant.status = 'disconnected';
            tenant.retryCount++;
            if (!isAuthFailure(reason)) scheduleRetry(tenantId);
          }
        });

        await tenant.botClient.connect();
      }
    } catch (error) {
      console.warn(`[Twitch:${tenantId}] Personal bot unavailable; continuing with shared bot:`, error);
      if (tenant.botClient && !isSharedCommunityBotClient(tenant.botClient)) {
        tenant.botClient.removeAllListeners();
        await disconnectIfOpen(tenant.botClient).catch(() => {});
      }
      tenant.botClient = null;
    }
    if (!tenant.botClient) {
      const sharedBot = await ensureCommunityBotForChannel(broadcasterUsername, clientId, clientSecret).catch((error) => {
        console.warn(`[Twitch:${tenantId}] Shared bot unavailable; continuing broadcaster setup:`, error);
        return null;
      });
      if (sharedBot) {
        tenant.botClient = sharedBot;
        tenant.botUsername = communityBotUsername || 'community-bot';
        console.log(`[Twitch:${tenantId}] Using shared community bot '${tenant.botUsername}'`);
      }
    }

    if (broadcasterTokenMismatch) {
      console.warn(`[Twitch:${tenantId}] Bot chat connected where possible; broadcaster send is disabled until re-authorization.`);
      if (broadcasterUsername) {
        await tryDeliverReauthNotice(tenantId, broadcasterUsername);
      }
      setupInProgress.delete(tenantId);
      return;
    }

    // Setup broadcaster client
    console.log(`[Twitch:${tenantId}] Connecting broadcaster as '${broadcasterUsername}'...`);
    tenant.broadcasterClient = new tmi.Client({
      options: { debug: false },
      identity: {
        username: broadcasterUsername,
        password: `oauth:${broadcasterOauthToken.replace('oauth:', '')}`,
      },
      channels: [broadcasterUsername],
    });

    tenant.broadcasterClient.on('connected', () => {
      console.log(`[Twitch:${tenantId}] Broadcaster connected.`);
      tenant.status = 'connected';
      tenant.retryCount = 0;

      const broadcast = (global as any).broadcast;
      if (typeof broadcast === 'function') {
        broadcast({
          type: 'twitch-status',
          payload: { status: 'connected', tenantId },
        }, tenantId);
      }
    });

    tenant.broadcasterClient.on('disconnected', (reason) => {
      console.log(`[Twitch:${tenantId}] Disconnected: ${reason}`);
      tenant.status = 'disconnected';
      tenant.retryCount++;

      if (!isAuthFailure(reason)) {
        scheduleRetry(tenantId);
      }
    });

    tenant.broadcasterClient.on('message', async (channel, tags, message, self) => {
      // Outbound visits must not run another tenant's bots a second time.
      if (channel.replace(/^#/, '').toLowerCase() !== broadcasterUsername.toLowerCase()) return;
      await dispatchIncomingTwitchMessage(channel, tags, message, self, tenantId);
    });

    await tenant.broadcasterClient.connect();
    console.log(`[Twitch:${tenantId}] Connection initiated.`);
  } catch (error) {
    console.error(`[Twitch:${tenantId}] Setup failed:`, error);
    const tenant = tenantClients.get(tenantId);
    if (tenant) tenant.status = 'disconnected';
    if (isAuthFailure(error)) {
      console.error(`[Twitch:${tenantId}] Authentication failed; reconnect retries paused until the Twitch account is re-authorized.`);
      tenantsNeedingReauth.add(tenantId);
      if (attemptedTokens) reconnectRefreshGate.markReauthorizationRequired(tenantId, attemptedTokens);
      if (tenant?.broadcasterUsername && clientId && clientSecret) {
        const sharedBot = await ensureCommunityBotForChannel(tenant.broadcasterUsername, clientId, clientSecret);
        if (sharedBot) {
          tenant.botClient = sharedBot;
          tenant.botUsername = communityBotUsername || 'community-bot';
        }
        await tryDeliverReauthNotice(tenantId, tenant.broadcasterUsername);
      } else if (tenant?.broadcasterUsername) {
        await tryDeliverReauthNotice(tenantId, tenant.broadcasterUsername);
      }
      return;
    }
    scheduleRetry(tenantId);
  } finally {
    setupInProgress.delete(tenantId);
  }
}

/**
 * Boot IRC connections for all known tenants.
 */
export async function setupAllTenants() {
  const tenantIds = await listTenants();
  console.log(`[Twitch] Booting ${tenantIds.length} tenant(s)...`);
  for (const id of tenantIds) {
    await setupTwitchClient(id).catch(e =>
      console.error(`[Twitch:${id}] Boot failed:`, e)
    );
  }
  await setupTheCountTwitchClient().catch((error) =>
    console.error('[Twitch:the-count] Boot failed:', error)
  );
}

/**
 * Get the tmi.js client for a specific tenant.
 */
export function getTwitchClient(type: 'bot' | 'broadcaster' = 'bot', tenantId?: string): tmi.Client | null {
  // If no tenantId, return the first connected tenant (legacy compat)
  if (!tenantId) {
    for (const [, tenant] of tenantClients) {
      const client = type === 'bot' ? (tenant.botClient || tenant.broadcasterClient) : tenant.broadcasterClient;
      if (isClientUsable(client)) return client;
      if (type === 'bot' && isClientUsable(tenant.broadcasterClient)) return tenant.broadcasterClient;
    }
    return null;
  }

  const tenant = tenantClients.get(tenantId);
  if (!tenant) return null;

  if (type === 'bot') {
    if (isClientUsable(tenant.botClient)) return tenant.botClient;
    if (isClientUsable(tenant.broadcasterClient)) return tenant.broadcasterClient;
    return null;
  }
  return isClientUsable(tenant.broadcasterClient) ? tenant.broadcasterClient : null;
}

/**
 * Get the connection status for a tenant.
 */
export function getTwitchStatus(tenantId?: string): string {
  if (!tenantId) {
    // Legacy: return first tenant's status
    for (const [, tenant] of tenantClients) {
      return tenant.status;
    }
    return 'disconnected';
  }
  return tenantClients.get(tenantId)?.status || 'disconnected';
}

/**
 * Get tenant ID from a channel name.
 */
export function getTenantIdFromChannel(channel: string): string | undefined {
  return channelToTenant.get(channel.replace('#', '').toLowerCase());
}

/**
 * Get all active tenant IDs.
 */
export function getActiveTenantIds(): string[] {
  return Array.from(tenantClients.entries())
    .filter(([, tenant]) => tenant.status === 'connected')
    .map(([tenantId]) => tenantId);
}

/**
 * Return current shared community bot runtime state.
 */
export function getTheCountTwitchClient(): tmi.Client | null {
  return isClientUsable(theCountTwitchClient) ? theCountTwitchClient : null;
}

export function getTheCountTwitchRuntimeState(): { connected: boolean; username: string | null; channels: string[] } {
  return {
    connected: Boolean(isClientUsable(theCountTwitchClient)),
    username: theCountTwitchClient ? THE_COUNT_TWITCH_LOGIN : null,
    channels: Array.from(theCountChannels),
  };
}

export function getCommunityBotRuntimeState(): { connected: boolean; username: string | null; channels: string[] } {
  return {
    connected: Boolean(communityBotClient),
    username: communityBotUsername || null,
    channels: Array.from(communityBotChannels),
  };
}

export async function disconnectCommunityBot(): Promise<void> {
  const priorSharedClient = communityBotClient;

  if (communityBotClient) {
    try {
      communityBotClient.removeAllListeners();
      await disconnectIfOpen(communityBotClient);
    } catch (error) {
      console.warn('[Twitch:community-bot] Disconnect cleanup warning:', error);
    }
  }

  communityBotClient = null;
  communityBotConnectPromise = null;
  communityBotUsername = '';
  communityBotChannels.clear();

  for (const [, tenant] of tenantClients) {
    if (priorSharedClient && tenant.botClient === priorSharedClient) {
      tenant.botClient = null;
      tenant.botUsername = '';
    }
  }
}

/**
 * Reconnect any tenants whose IRC clients have dropped.
 * Called periodically from the polling service.
 */
export async function reconnectDisconnectedTenants(): Promise<void> {
  if (!isClientUsable(theCountTwitchClient) && !theCountConnectPromise) {
    await setupTheCountTwitchClient().catch((error) =>
      console.error('[Twitch:the-count] Health-check reconnect failed:', error)
    );
  }

  for (const [tenantId, tenant] of tenantClients) {
    if (tenantsNeedingReauth.has(tenantId)) {
      const current = await getStoredTokens(tenantId);
      if (!current || !reconnectRefreshGate.shouldAttempt(tenantId, current)) continue;
      tenantsNeedingReauth.delete(tenantId);
      tenant.status = 'disconnected';
    }
    if (tenant.status === 'disconnected' && !setupInProgress.has(tenantId)) {
      console.log(`[Twitch:${tenantId}] Health check: disconnected, reconnecting...`);
      tenant.retryCount = 0;
      lastRetryReset.set(tenantId, Date.now());
      await setupTwitchClient(tenantId).catch(e =>
        console.error(`[Twitch:${tenantId}] Health-check reconnect failed:`, e)
      );
    }
  }
}

/**
 * Disconnect a specific tenant's IRC clients.
 */
export async function disconnectTenant(tenantId: string): Promise<void> {
  const tenant = tenantClients.get(tenantId);
  if (!tenant) return;

  if (tenant.botClient) {
    if (!isSharedCommunityBotClient(tenant.botClient)) {
      try { tenant.botClient.removeAllListeners(); await disconnectIfOpen(tenant.botClient); } catch {}
    }
  }
  if (tenant.broadcasterClient) {
    try { tenant.broadcasterClient.removeAllListeners(); await disconnectIfOpen(tenant.broadcasterClient); } catch {}
  }

  channelToTenant.delete(tenant.broadcasterUsername.toLowerCase());
  tenantClients.delete(tenantId);
  console.log(`[Twitch:${tenantId}] Disconnected and removed.`);
}
