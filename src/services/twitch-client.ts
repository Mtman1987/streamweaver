import * as tmi from 'tmi.js';
import { getStoredTokens, ensureValidToken } from '../lib/token-utils.server';
import type { StoredTokens } from '../lib/token-utils.server';
import { listTenants, communityBotTokensPath } from '../lib/tenant';
import { handleTwitchMessage } from './chat-dispatcher';
import { promises as fsp } from 'fs';

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
let communityBotConnectPromise: Promise<tmi.Client | null> | null = null;
const tenantsNeedingReauth = new Set<string>();
const lastReauthNotice = new Map<string, number>();

function isSharedCommunityBotClient(client: tmi.Client | null): boolean {
  return Boolean(client && communityBotClient && client === communityBotClient);
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

function isAuthFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || '');
  return /login authentication failed|authentication failed|invalid oauth|bad auth/i.test(message);
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
  try {
    const raw = await fsp.readFile(communityBotTokensPath(), 'utf-8');
    const parsed = JSON.parse(raw);
    // Accept either dedicated community keys or legacy bot keys.
    const normalized: StoredTokens = {
      communityBotToken: parsed.communityBotToken || parsed.botToken || parsed.access_token,
      communityBotRefreshToken: parsed.communityBotRefreshToken || parsed.botRefreshToken || parsed.refresh_token,
      communityBotUsername: parsed.communityBotUsername || parsed.botUsername || parsed.username,
      communityBotTokenExpiry: parsed.communityBotTokenExpiry || parsed.botTokenExpiry,
    };
    if (!normalized.communityBotToken || !normalized.communityBotRefreshToken || !normalized.communityBotUsername) {
      return null;
    }
    return normalized;
  } catch {
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
          if (self) return;
          const channelName = channel.replace('#', '').toLowerCase();
          const tenantId = channelToTenant.get(channelName);
          if (!tenantId) return;

          if (tenantsNeedingReauth.has(tenantId) && String(message || '').startsWith('!')) {
            await sendReauthNotice(client, channelName, tenantId, tags?.username || tags?.['display-name']);
            return;
          }

          await handleTwitchMessage(channel, tags, message, self);
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
  if (!client) return null;

  const channelLogin = channel.toLowerCase();
  if (!communityBotChannels.has(channelLogin)) {
    try {
      await client.join(channelLogin);
      communityBotChannels.add(channelLogin);
      console.log(`[Twitch:community-bot] Joined #${channelLogin}`);
    } catch (error) {
      console.error(`[Twitch:community-bot] Failed to join #${channelLogin}:`, error);
    }
  }

  return client;
}

async function sendReauthNotice(client: tmi.Client, channel: string, tenantId: string, username?: string): Promise<void> {
  const key = `${tenantId}:${String(username || 'chat').toLowerCase()}`;
  const now = Date.now();
  if (now - (lastReauthNotice.get(key) || 0) < 60_000) return;
  lastReauthNotice.set(key, now);
  const mention = username ? `@${username}, ` : '';
  await client.say(channel, `${mention}StreamWeaver needs the streamer to re-authorize Twitch before commands can run. Open StreamWeaver > Integrations > Twitch > Re-authorize.`);
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

  try {
    const tokens = await getStoredTokens(tenantId);
    if (!tokens?.broadcasterToken || !tokens?.broadcasterRefreshToken) {
      console.error(`[Twitch:${tenantId}] No tokens available.`);
      if (tokens?.broadcasterUsername) {
        channelToTenant.set(tokens.broadcasterUsername.toLowerCase(), tenantId);
        tenantsNeedingReauth.add(tenantId);
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
      broadcasterTokenMismatch = true;
    }

    const broadcasterUsername = broadcasterTokenMismatch
      ? (tokens.loginUsername || '')
      : (broadcasterIdentity?.login || tokens.broadcasterUsername || tokens.loginUsername || '');
    const botUsername = tokens.botUsername || '';
    const hasBotToken = tokens.botToken && tokens.botRefreshToken;

    console.log(`[Twitch:${tenantId}] Broadcaster: ${broadcasterUsername}, Bot: ${botUsername || 'none'}`);

    if (broadcasterUsername) {
      channelToTenant.set(broadcasterUsername.toLowerCase(), tenantId);
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
    } else {
      const sharedBot = await ensureCommunityBotForChannel(broadcasterUsername, clientId, clientSecret);
      if (sharedBot) {
        tenant.botClient = sharedBot;
        tenant.botUsername = communityBotUsername || 'community-bot';
        console.log(`[Twitch:${tenantId}] Using shared community bot '${tenant.botUsername}'`);
      }
    }

    if (broadcasterTokenMismatch) {
      console.warn(`[Twitch:${tenantId}] Bot chat connected where possible; broadcaster send is disabled until re-authorization.`);
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
      // Resolve tenant from channel
      const channelName = channel.replace('#', '').toLowerCase();
      const msgTenantId = channelToTenant.get(channelName) || tenantId;

      // Check for shared chat
      const { isMirroredSharedMessage, resolveRoomIdToLogin, shouldIgnoreMirrored } = await import('./shared-chat');
      if (shouldIgnoreMirrored(tags)) return;

      let effectiveChannel = channel;
      const isMirrored = isMirroredSharedMessage(tags);
      if (isMirrored) {
        const sourceRoomId = tags['source-room-id'] || tags['source-id'];
        effectiveChannel = '#' + await resolveRoomIdToLogin(sourceRoomId, channelName);
      }

      // Broadcast to WebSocket clients
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

      await handleTwitchMessage(effectiveChannel, tags, message, self);
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
      if (tenant?.broadcasterUsername && clientId && clientSecret) {
        const sharedBot = await ensureCommunityBotForChannel(tenant.broadcasterUsername, clientId, clientSecret);
        if (sharedBot) {
          tenant.botClient = sharedBot;
          tenant.botUsername = communityBotUsername || 'community-bot';
        }
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
export function getCommunityBotRuntimeState(): { connected: boolean; username: string | null; channels: string[] } {
  return {
    connected: Boolean(communityBotClient),
    username: communityBotUsername || null,
    channels: Array.from(communityBotChannels),
  };
}

/**
 * Reconnect any tenants whose IRC clients have dropped.
 * Called periodically from the polling service.
 */
export async function reconnectDisconnectedTenants(): Promise<void> {
  for (const [tenantId, tenant] of tenantClients) {
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
