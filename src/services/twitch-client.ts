import * as tmi from 'tmi.js';
import { getStoredTokens, ensureValidToken } from '../lib/token-utils.server';
import type { StoredTokens } from '../lib/token-utils.server';
import { listTenants } from '../lib/tenant';
import { handleTwitchMessage } from './chat-dispatcher';

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

const MAX_RETRY_ATTEMPTS = 3;
const setupInProgress = new Set<string>();

function scheduleRetry(tenantId: string) {
  if (setupInProgress.has(tenantId)) return;
  const tenant = tenantClients.get(tenantId);
  if (tenant && tenant.retryCount >= MAX_RETRY_ATTEMPTS) {
    console.log(`[Twitch:${tenantId}] Max retries reached, stopping.`);
    return;
  }
  console.log(`[Twitch:${tenantId}] Will retry in 5s...`);
  setTimeout(() => {
    setupTwitchClient(tenantId).catch(e =>
      console.error(`[Twitch:${tenantId}] Retry failed:`, e)
    );
  }, 5000);
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
      setupInProgress.delete(tenantId);
      return;
    }

    const broadcasterUsername = tokens.broadcasterUsername || '';
    const botUsername = tokens.botUsername || '';
    const hasBotToken = tokens.botToken && tokens.botRefreshToken;

    console.log(`[Twitch:${tenantId}] Broadcaster: ${broadcasterUsername}, Bot: ${botUsername || 'none'}`);

    const broadcasterOauthToken = await ensureValidToken(clientId, clientSecret, 'broadcaster', tokens, tenantId);

    // Disconnect existing clients for this tenant
    const existing = tenantClients.get(tenantId);
    if (existing) {
      if (existing.botClient) {
        try { existing.botClient.removeAllListeners(); await existing.botClient.disconnect(); } catch {}
      }
      if (existing.broadcasterClient) {
        try { existing.broadcasterClient.removeAllListeners(); await existing.broadcasterClient.disconnect(); } catch {}
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
    channelToTenant.set(broadcasterUsername.toLowerCase(), tenantId);

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
      });

      await tenant.botClient.connect();
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

      if (reason !== 'Login authentication failed') {
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
      if (client) return client;
    }
    return null;
  }

  const tenant = tenantClients.get(tenantId);
  if (!tenant) return null;

  if (type === 'bot') {
    return tenant.botClient || tenant.broadcasterClient;
  }
  return tenant.broadcasterClient;
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
  return Array.from(tenantClients.keys());
}

/**
 * Disconnect a specific tenant's IRC clients.
 */
export async function disconnectTenant(tenantId: string): Promise<void> {
  const tenant = tenantClients.get(tenantId);
  if (!tenant) return;

  if (tenant.botClient) {
    try { tenant.botClient.removeAllListeners(); await tenant.botClient.disconnect(); } catch {}
  }
  if (tenant.broadcasterClient) {
    try { tenant.broadcasterClient.removeAllListeners(); await tenant.broadcasterClient.disconnect(); } catch {}
  }

  channelToTenant.delete(tenant.broadcasterUsername.toLowerCase());
  tenantClients.delete(tenantId);
  console.log(`[Twitch:${tenantId}] Disconnected and removed.`);
}
