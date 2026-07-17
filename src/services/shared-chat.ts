/**
 * Shared Chat Detection & Source-Only Messaging
 *
 * When a streamer is in a Twitch shared-chat session, normal client.say()
 * messages get mirrored to every participant. This module detects shared
 * chat and uses the Twitch Helix API with `for_source_only: true` so the
 * bot message only appears in the originating channel.
 *
 * Falls back to normal IRC if the API call fails.
 */

import { promises as fs } from 'fs';
import { resolve } from 'path';
import { communityBotTokensPath, tenantPath } from '../lib/tenant';

let appAccessToken: string | null = null;
let appTokenExpiry = 0;

// ---------------------------------------------------------------------------
// Chat mode: 'single' (default) ignores mirrored messages,
//            'shared' processes them like normal.
// ---------------------------------------------------------------------------

export type ChatMode = 'single' | 'shared';
const chatModeByTenant = new Map<string, ChatMode>();

function chatModeFilePath(tenantId?: string): string {
  if (tenantId) return tenantPath(tenantId, 'data/chat-mode.json');
  return resolve(process.cwd(), 'data', 'chat-mode.json');
}

function chatModeKey(tenantId?: string): string {
  return tenantId || '__global__';
}

async function loadChatMode(tenantId?: string): Promise<void> {
  try {
    const raw = await fs.readFile(chatModeFilePath(tenantId), 'utf-8');
    const data = JSON.parse(raw);
    if (data.mode === 'shared' || data.mode === 'single') {
      chatModeByTenant.set(chatModeKey(tenantId), data.mode);
    }
  } catch {}
}

async function saveChatMode(tenantId?: string): Promise<void> {
  try {
    const filePath = chatModeFilePath(tenantId);
    await fs.mkdir(resolve(filePath, '..'), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify({ mode: chatModeByTenant.get(chatModeKey(tenantId)) || 'single' }));
  } catch {}
}

// Load global on module init
loadChatMode();

export function getChatMode(tenantId?: string): ChatMode {
  return chatModeByTenant.get(chatModeKey(tenantId)) || 'single';
}

export async function toggleChatMode(tenantId?: string): Promise<ChatMode> {
  const key = chatModeKey(tenantId);
  const current = chatModeByTenant.get(key) || 'single';
  const next = current === 'single' ? 'shared' : 'single';
  chatModeByTenant.set(key, next);
  await saveChatMode(tenantId);
  return next;
}

/**
 * Returns true if a mirrored message should be ignored based on current mode.
 */
export function shouldIgnoreMirrored(tags: Record<string, any>, tenantId?: string): boolean {
  return getChatMode(tenantId) === 'single' && isMirroredSharedMessage(tags);
}

// Cache shared-chat status per channel (refreshed every 60s)
const sharedChatCache = new Map<string, { isShared: boolean; expires: number }>();
const CACHE_TTL = 60_000;

// Cooldown for "please /mod the bot" warnings (once per channel per 24h)
const SOURCE_WARN_COOLDOWN = 24 * 60 * 60 * 1000;
const sourceWarnedAt = new Map<string, number>();

// Room-ID → login lookup cache (permanent, IDs don't change)
const roomIdToLogin = new Map<string, string>();

// ---------------------------------------------------------------------------
// Token helpers
// ---------------------------------------------------------------------------

async function getAppToken(): Promise<string> {
  if (appAccessToken && Date.now() < appTokenExpiry) return appAccessToken;

  const clientId = process.env.TWITCH_CLIENT_ID || process.env.NEXT_PUBLIC_TWITCH_CLIENT_ID;
  const clientSecret = process.env.TWITCH_CLIENT_SECRET || process.env.NEXT_PUBLIC_TWITCH_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error('Twitch client credentials not configured');

  const res = await fetch('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  const data = await res.json();
  if (!data.access_token) throw new Error('Failed to get app access token');

  appAccessToken = data.access_token;
  appTokenExpiry = Date.now() + (data.expires_in - 120) * 1000;
  return appAccessToken!;
}

function getClientId(): string {
  return process.env.TWITCH_CLIENT_ID || process.env.NEXT_PUBLIC_TWITCH_CLIENT_ID || '';
}

function getClientSecret(): string {
  return process.env.TWITCH_CLIENT_SECRET || process.env.NEXT_PUBLIC_TWITCH_CLIENT_SECRET || '';
}

type SharedChatLookupAuth = {
  label: 'broadcaster' | 'bot' | 'app';
  token: string;
};

async function getSharedChatLookupAuthCandidates(tenantId?: string): Promise<SharedChatLookupAuth[]> {
  const candidates: SharedChatLookupAuth[] = [];
  const clientId = getClientId();
  const clientSecret = getClientSecret();

  if (tenantId && clientId && clientSecret) {
    try {
      const { getStoredTokens, ensureValidToken } = require('../lib/token-utils.server');
      const tokens = await getStoredTokens(tenantId);

      if (tokens?.broadcasterToken && tokens?.broadcasterRefreshToken) {
        candidates.push({
          label: 'broadcaster',
          token: await ensureValidToken(clientId, clientSecret, 'broadcaster', tokens, tenantId),
        });
      }

      if (tokens?.botToken && tokens?.botRefreshToken) {
        candidates.push({
          label: 'bot',
          token: await ensureValidToken(clientId, clientSecret, 'bot', tokens, tenantId),
        });
      }
    } catch (error) {
      console.warn(`[SharedChat] Failed to load tenant lookup tokens for ${tenantId}:`, error);
    }
  }

  candidates.push({ label: 'app', token: await getAppToken() });
  return candidates.filter((candidate, index, list) =>
    Boolean(candidate.token) && list.findIndex((entry) => entry.token === candidate.token) === index,
  );
}

// ---------------------------------------------------------------------------
// Shared-chat detection
// ---------------------------------------------------------------------------

/**
 * Check if a channel is currently in a shared-chat session via Helix.
 */
export async function isChannelInSharedChat(channelLogin: string, tenantId?: string): Promise<boolean> {
  const key = channelLogin.toLowerCase();
  const cached = sharedChatCache.get(key);
  if (cached && Date.now() < cached.expires) return cached.isShared;

  try {
    const clientId = getClientId();
    const candidates = await getSharedChatLookupAuthCandidates(tenantId);

    for (const candidate of candidates) {
      const headers = { 'Client-ID': clientId, Authorization: `Bearer ${candidate.token}` };

      const userRes = await fetch(
        `https://api.twitch.tv/helix/users?login=${encodeURIComponent(key)}`,
        { headers },
      );
      if (!userRes.ok) {
        console.warn(`[SharedChat] User lookup failed for ${key} via ${candidate.label} token (${userRes.status})`);
        continue;
      }

      const userData = await userRes.json();
      const broadcasterId = userData.data?.[0]?.id;
      if (!broadcasterId) {
        sharedChatCache.set(key, { isShared: false, expires: Date.now() + CACHE_TTL });
        return false;
      }

      const scRes = await fetch(
        `https://api.twitch.tv/helix/shared_chat/session?broadcaster_id=${broadcasterId}`,
        { headers },
      );

      if (scRes.status === 404 || scRes.status === 204) {
        sharedChatCache.set(key, { isShared: false, expires: Date.now() + CACHE_TTL });
        return false;
      }

      if (!scRes.ok) {
        console.warn(`[SharedChat] Session lookup failed for ${key} via ${candidate.label} token (${scRes.status})`);
        continue;
      }

      const scData = await scRes.json();
      const session = Array.isArray(scData?.data) ? scData.data[0] : scData?.data;
      const participantCount = Array.isArray(session?.participants) ? session.participants.length : 0;
      const isShared = Boolean(session?.session_id || participantCount > 1);
      sharedChatCache.set(key, { isShared, expires: Date.now() + CACHE_TTL });
      console.log(
        `[SharedChat] Detection for ${key} via ${candidate.label} token: isShared=${isShared} participants=${participantCount}`,
      );
      return isShared;
    }

    sharedChatCache.set(key, { isShared: false, expires: Date.now() + CACHE_TTL });
    return false;
  } catch (e) {
    console.error(`[SharedChat] Detection failed for ${key}:`, e);
    sharedChatCache.set(key, { isShared: false, expires: Date.now() + CACHE_TTL });
    return false;
  }
}

// ---------------------------------------------------------------------------
// Source-only message via Helix API
// ---------------------------------------------------------------------------

/**
 * Get a valid user access token for the bot or broadcaster from stored tokens.
 * Uses ensureValidToken to auto-refresh expired tokens.
 */
type HelixAuthCandidate = {
  kind: 'bot' | 'community-bot' | 'broadcaster';
  token: string;
};

export type SharedChatSendFailureReason =
  | 'broadcaster-not-found'
  | 'sender-not-found'
  | 'permission'
  | 'api-error'
  | 'exception'
  | 'sender-unavailable';

export class SharedChatSendError extends Error {
  constructor(public readonly reason: SharedChatSendFailureReason, channel: string) {
    super(`Shared chat source-only send failed for #${channel} (${reason})`);
    this.name = 'SharedChatSendError';
  }
}

async function getUserTokenCandidates(as: 'bot' | 'broadcaster', tenantId?: string): Promise<HelixAuthCandidate[]> {
  try {
    const { getStoredTokens, ensureValidToken } = require('../lib/token-utils.server');
    const clientId = process.env.TWITCH_CLIENT_ID || process.env.NEXT_PUBLIC_TWITCH_CLIENT_ID;
    const clientSecret = process.env.TWITCH_CLIENT_SECRET;
    if (!clientId || !clientSecret) return [];

    const tokens = await getStoredTokens(tenantId);
    const candidates: HelixAuthCandidate[] = [];

    if (as === 'bot' && tokens?.botToken && tokens?.botRefreshToken) {
      candidates.push({
        kind: 'bot',
        token: await ensureValidToken(clientId, clientSecret, 'bot', tokens, tenantId),
      });
    }

    try {
      const raw = await fs.readFile(communityBotTokensPath(), 'utf-8');
      const communityTokens = JSON.parse(raw);
      if (communityTokens?.communityBotToken && communityTokens?.communityBotRefreshToken) {
        candidates.push({
          kind: 'community-bot',
          token: await ensureValidToken(clientId, clientSecret, 'community-bot', communityTokens),
        });
      }
    } catch {}

    if (tokens?.broadcasterToken && tokens?.broadcasterRefreshToken) {
      candidates.push({
        kind: 'broadcaster',
        token: await ensureValidToken(clientId, clientSecret, 'broadcaster', tokens, tenantId),
      });
    }

    return candidates.filter((candidate, index, list) =>
      Boolean(candidate.token) && list.findIndex((entry) => entry.token === candidate.token) === index,
    );
  } catch (e) {
    console.warn('[SharedChat] getUserTokenCandidates failed:', e);
    return [];
  }
}

async function sendViaHelixAPI(
  targetChannel: string,
  senderLogin: string,
  message: string,
  userAuthCandidates: HelixAuthCandidate[] = [],
  attempt = 0,
): Promise<{ success: boolean; reason?: string }> {
  try {
    const appToken = await getAppToken();
    const clientId = getClientId();

    // Resolve broadcaster ID
    const bRes = await fetch(
      `https://api.twitch.tv/helix/users?login=${encodeURIComponent(targetChannel)}`,
      { headers: { 'Client-ID': clientId, Authorization: `Bearer ${appToken}` } },
    );
    if (!bRes.ok) {
      console.warn(`[SharedChat] Broadcaster lookup failed for ${targetChannel} (${bRes.status})`);
      return { success: false, reason: 'api-error' };
    }
    const bData = await bRes.json();
    const broadcasterId = bData.data?.[0]?.id;
    if (!broadcasterId) return { success: false, reason: 'broadcaster-not-found' };

    // Resolve sender ID
    const sRes = await fetch(
      `https://api.twitch.tv/helix/users?login=${encodeURIComponent(senderLogin)}`,
      { headers: { 'Client-ID': clientId, Authorization: `Bearer ${appToken}` } },
    );
    const sData = await sRes.json();
    const senderId = sData.data?.[0]?.id;
    if (!senderId) return { success: false, reason: 'sender-not-found' };

    const sendCandidates = [
      { kind: 'app' as const, token: appToken },
      ...userAuthCandidates,
    ].filter((candidate, index, list) =>
      Boolean(candidate.token) && list.findIndex((entry) => entry.token === candidate.token) === index,
    );
    let lastStatus = 0;
    let lastErrorText = '';
    let permissionFailure = false;
    const senderAuthKinds = userAuthCandidates.map((candidate) => candidate.kind).join(', ') || 'none';
    for (const candidate of sendCandidates) {
      const res = await fetch('https://api.twitch.tv/helix/chat/messages', {
        method: 'POST',
        headers: {
          'Client-ID': clientId,
          Authorization: `Bearer ${candidate.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          broadcaster_id: broadcasterId,
          sender_id: senderId,
          message,
          for_source_only: true,
        }),
      });

      if (res.ok) {
        console.log(`[SharedChat] Source-only Helix send succeeded using ${candidate.kind} token for #${targetChannel}`);
        return { success: true };
      }

      lastStatus = res.status;
      lastErrorText = await res.text();
      console.warn(`[SharedChat] Helix source-only send failed using ${candidate.kind} token (${res.status}): ${lastErrorText}`);
      const lower = lastErrorText.toLowerCase();
      permissionFailure ||= lower.includes('channel:bot') ||
        lower.includes('user:bot') ||
        lower.includes('user:write:chat') ||
        lower.includes('sender must be a moderator') ||
        lower.includes('must have authorized') ||
        lower.includes('sender_id must match');
    }

    if (permissionFailure) {
      console.warn(
        `[SharedChat] Source-only send exhausted app and user-token authorization. Available sender token kinds: ${senderAuthKinds}`,
      );
      return { success: false, reason: 'permission' };
    }

    if (lastStatus === 401 && attempt < 1 && /invalid oauth token/i.test(lastErrorText)) {
      appAccessToken = null;
      appTokenExpiry = 0;
      return sendViaHelixAPI(targetChannel, senderLogin, message, userAuthCandidates, attempt + 1);
    }
    return { success: false, reason: 'api-error' };
  } catch (e: any) {
    console.error('[SharedChat] Helix send error:', e.message);
    return { success: false, reason: 'exception' };
  }
}

// ---------------------------------------------------------------------------
// Public: send with shared-chat awareness
// ---------------------------------------------------------------------------

export interface SendOptions {
  /** The tmi.js client to fall back to */
  client: any;
  /** Channel to send to (no # prefix) */
  channel: string;
  /** Message text */
  message: string;
  /** Which identity is sending ('bot' | 'broadcaster') */
  as: 'bot' | 'broadcaster';
  /** Tenant ID for broadcasting */
  tenantId?: string;
}

function getClientDebugState(client: any): { readyState: string; joinedChannels: string[] } {
  let readyState = 'unknown';
  try {
    readyState = typeof client?.readyState === 'function'
      ? String(client.readyState() || 'unknown')
      : 'unavailable';
  } catch {
    readyState = 'error';
  }

  const joinedChannels = typeof client?.getChannels === 'function'
    ? client.getChannels().map((entry: string) => String(entry || '').replace(/^#/, '').toLowerCase())
    : [];

  return { readyState, joinedChannels };
}

async function ensureJoinedAndSay(client: any, normalizedChannel: string, message: string): Promise<void> {
  const { readyState, joinedChannels } = getClientDebugState(client);
  console.log(`[SharedChat] Preparing IRC send to #${normalizedChannel}; readyState=${readyState}; joined=${joinedChannels.join(', ') || '(none)'}`);

  if (!joinedChannels.includes(normalizedChannel)) {
    console.warn(`[SharedChat] Client was not joined to #${normalizedChannel}; joining before send.`);
    try {
      await client.join(normalizedChannel);
    } catch (error) {
      console.warn(`[SharedChat] Join before send failed for #${normalizedChannel}:`, error);
    }
  }

  const { readyState: refreshedReadyState, joinedChannels: refreshedChannels } = getClientDebugState(client);
  console.log(`[SharedChat] Sending IRC message to #${normalizedChannel}; joined channels: ${refreshedChannels.join(', ') || '(unknown)'}`);

  if (refreshedReadyState !== 'OPEN' && refreshedReadyState !== 'unavailable' && refreshedReadyState !== 'unknown') {
    throw new Error(`Twitch IRC client not open (readyState=${refreshedReadyState})`);
  }

  await client.say(`#${normalizedChannel}`, message);
}

/**
 * Send a chat message with shared-chat awareness.
 * If the channel is in shared chat, tries Helix API with source-only first.
 * Falls back to normal client.say() if API fails or channel is not shared.
 */
export async function sendWithSharedChatAwareness(opts: SendOptions): Promise<void> {
  const { client, channel, message, as, tenantId } = opts;
  const normalized = channel.toLowerCase().replace(/^#/, '');

  const inShared = await isChannelInSharedChat(normalized, tenantId);

  // Broadcast shared chat status to UI
  if (typeof (global as any).broadcast === 'function') {
    (global as any).broadcast({
      type: 'shared-chat-status',
      payload: { channel: normalized, isShared: inShared }
    }, tenantId);
  }

  if (inShared) {
    const senderLogin =
      (typeof client?.getUsername === 'function' ? String(client.getUsername() || '') : '').toLowerCase() ||
      (
        as === 'bot'
          ? (process.env.NEXT_PUBLIC_TWITCH_BOT_USERNAME || process.env.TWITCH_BOT_USERNAME || '')
          : (process.env.TWITCH_BROADCASTER_USERNAME || process.env.NEXT_PUBLIC_TWITCH_BROADCASTER_USERNAME || '')
      ).toLowerCase();

    const userAuthCandidates = await getUserTokenCandidates(as, tenantId);
    if (senderLogin) {
      const result = await sendViaHelixAPI(normalized, senderLogin, message, userAuthCandidates);
      if (result.success) {
        console.log(`[SharedChat] Source-only message sent to ${normalized}`);
        return;
      }

      console.warn(`[SharedChat] Source-only send failed for ${normalized} (${result.reason}); skipping IRC fallback to avoid mirrored shared-chat bot output.`);

      if (result.reason === 'permission') {
        const lastWarn = sourceWarnedAt.get(normalized) || 0;
        if (Date.now() - lastWarn > SOURCE_WARN_COOLDOWN) {
          sourceWarnedAt.set(normalized, Date.now());
          console.warn(
            `[SharedChat] Source-only send needs Twitch bot permissions for #${normalized}. The bot response was not sent through IRC because IRC would mirror into every shared-chat participant.`,
          );
        }
      }

      throw new SharedChatSendError((result.reason || 'api-error') as SharedChatSendFailureReason, normalized);
    }

    throw new SharedChatSendError('sender-unavailable', normalized);
  }

  // Normal IRC send
  try {
    await ensureJoinedAndSay(client, normalized, message);
  } catch (error) {
    console.warn(`[SharedChat] Primary IRC send failed for #${normalized}; attempting reconnect once.`, error);
    if (tenantId) {
      try {
        const twitchClientModule = require('./twitch-client');
        await twitchClientModule.setupTwitchClient(String(tenantId));
        const retryClient = twitchClientModule.getTwitchClient(as === 'broadcaster' ? 'broadcaster' : 'bot', String(tenantId))
          || twitchClientModule.getTwitchClient('bot', String(tenantId));
        if (retryClient) {
          await ensureJoinedAndSay(retryClient, normalized, message);
          return;
        }
      } catch (retryError) {
        console.error(`[SharedChat] Reconnect retry failed for tenant ${tenantId}:`, retryError);
      }
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Incoming message helpers (for deduplicating mirrored messages)
// ---------------------------------------------------------------------------

/**
 * Returns true if the incoming TMI message is a mirrored shared-chat message
 * (i.e. it originated from a different channel than the one we received it in).
 */
export function isMirroredSharedMessage(tags: Record<string, any>): boolean {
  const roomId = tags['room-id'];
  const sourceRoomId = tags['source-room-id'] || tags['source-id'];
  return Boolean(roomId && sourceRoomId && roomId !== sourceRoomId);
}

/**
 * Resolve a room-id to a channel login via Helix (cached permanently).
 */
export async function resolveRoomIdToLogin(roomId: string, fallback: string): Promise<string> {
  const key = String(roomId).trim();
  if (!key) return fallback;
  if (roomIdToLogin.has(key)) return roomIdToLogin.get(key)!;

  try {
    const token = await getAppToken();
    const clientId = getClientId();
    const res = await fetch(
      `https://api.twitch.tv/helix/users?id=${encodeURIComponent(key)}`,
      { headers: { 'Client-ID': clientId, Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) return fallback;
    const data = await res.json();
    const login = data?.data?.[0]?.login?.toLowerCase();
    if (!login) return fallback;
    roomIdToLogin.set(key, login);
    return login;
  } catch {
    return fallback;
  }
}

/**
 * Force-clear the shared chat cache for a channel (useful after detecting
 * a session start/end via EventSub).
 */
export function invalidateSharedChatCache(channelLogin: string): void {
  sharedChatCache.delete(channelLogin.toLowerCase());
}
