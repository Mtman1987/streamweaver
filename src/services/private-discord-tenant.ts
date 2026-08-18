import { bootstrapTenant, listTenants } from '@/lib/tenant';
import { readDiscordConfig, updateDiscordConfig } from '@/lib/discord-config';

const SPMT_BASE_URL = String(process.env.SPMT_BASE_URL || 'https://spmt.live').replace(/\/$/, '');

type PrivateDiscordTenantSource = 'dm-channel' | 'discord-user' | 'spmt-discord';

export type PrivateDiscordTenantResolution = {
  tenantId: string;
  source: PrivateDiscordTenantSource;
};

function clean(value: unknown): string {
  return String(value || '').trim();
}

function isDiscordSnowflake(value: string): boolean {
  return /^\d{10,32}$/.test(value);
}

async function verifyDiscordDmMessage(input: {
  channelId: string;
  messageId: string;
  discordUserId: string;
}): Promise<boolean> {
  const botToken = clean(process.env.DISCORD_BOT_TOKEN);
  if (!botToken) return false;
  if (!isDiscordSnowflake(input.channelId) || !isDiscordSnowflake(input.messageId) || !isDiscordSnowflake(input.discordUserId)) {
    return false;
  }

  try {
    const response = await fetch(
      `https://discord.com/api/v10/channels/${encodeURIComponent(input.channelId)}/messages/${encodeURIComponent(input.messageId)}`,
      {
        headers: { Authorization: `Bot ${botToken}` },
        cache: 'no-store',
        signal: typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
          ? AbortSignal.timeout(5_000)
          : undefined,
      },
    );
    if (!response.ok) return false;
    const message = await response.json().catch(() => null) as any;
    return !message?.author?.bot && clean(message?.author?.id) === input.discordUserId;
  } catch {
    return false;
  }
}

async function resolveSpmtIdentity(discordUserId: string): Promise<{
  tenantId: string;
  username: string;
  discordUsername: string;
} | null> {
  try {
    const url = new URL('/api/user/lookup', `${SPMT_BASE_URL}/`);
    url.searchParams.set('discord_id', discordUserId);
    const response = await fetch(url, {
      cache: 'no-store',
      signal: typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
        ? AbortSignal.timeout(5_000)
        : undefined,
    });
    if (!response.ok) return null;
    const user = await response.json().catch(() => null) as any;
    const returnedDiscordId = clean(user?.discordId || user?.discord_id || user?.discordUserId || user?.discord_user_id);
    if (returnedDiscordId !== discordUserId) return null;

    const tenantId = clean(user?.twitchId || user?.twitch_id || user?.id);
    if (!tenantId || tenantId.length > 128) return null;
    const username = clean(user?.twitchUsername || user?.twitch_username || user?.username) || `discord-${discordUserId}`;
    const discordUsername = clean(user?.discordUsername || user?.discord_username);
    return { tenantId, username, discordUsername };
  } catch {
    return null;
  }
}

async function persistVerifiedDmBinding(input: {
  tenantId: string;
  discordUserId: string;
  discordUsername: string;
  channelId: string;
}): Promise<void> {
  await updateDiscordConfig({
    discordUserId: input.discordUserId,
    ...(input.discordUsername ? { discordUsername: input.discordUsername } : {}),
    dmChannelId: input.channelId,
    dmEnabled: true,
    dmChannelUpdatedAt: new Date().toISOString(),
  } as any, input.tenantId);
}

/**
 * Resolve a private Discord DM to exactly one StreamWeaver tenant.
 *
 * Privacy invariant: there is deliberately NO Commander/admin/single-tenant fallback.
 * An inbound DM must be proven to exist in Discord and authored by the immutable
 * Discord user ID before it can read or write any tenant's private history.
 */
export async function resolvePrivateDiscordTenant(input: {
  discordUserId?: string;
  discordUsername?: string;
  channelId?: string;
  messageId?: string;
}): Promise<PrivateDiscordTenantResolution | undefined> {
  const discordUserId = clean(input.discordUserId);
  const discordUsername = clean(input.discordUsername);
  const channelId = clean(input.channelId);
  const messageId = clean(input.messageId);

  if (!await verifyDiscordDmMessage({ channelId, messageId, discordUserId })) {
    return undefined;
  }

  const tenantIds = await listTenants().catch(() => []);

  // Strongest local proof: this exact verified DM channel is already bound to a tenant.
  for (const tenantId of tenantIds) {
    if (tenantId.startsWith('__kick_silent__')) continue;
    const config = await readDiscordConfig(tenantId).catch(() => null) as Record<string, unknown> | null;
    if (clean(config?.dmChannelId) !== channelId) continue;
    const configuredDiscordId = clean(config?.discordUserId);
    if (configuredDiscordId && configuredDiscordId !== discordUserId) {
      console.error('[Private DM] Refusing DM-channel binding with mismatched Discord user', {
        tenantId,
        channelId,
        configuredDiscordId,
        discordUserId,
      });
      return undefined;
    }
    if (!configuredDiscordId) {
      await persistVerifiedDmBinding({ tenantId, discordUserId, discordUsername, channelId }).catch(() => undefined);
    }
    return { tenantId, source: 'dm-channel' };
  }

  // Next strongest local proof: the immutable Discord user ID is already bound to a tenant.
  for (const tenantId of tenantIds) {
    if (tenantId.startsWith('__kick_silent__')) continue;
    const config = await readDiscordConfig(tenantId).catch(() => null) as Record<string, unknown> | null;
    if (clean(config?.discordUserId) !== discordUserId) continue;
    await persistVerifiedDmBinding({ tenantId, discordUserId, discordUsername, channelId }).catch(() => undefined);
    return { tenantId, source: 'discord-user' };
  }

  // A user may have a canonical SPMT account before ever opening StreamWeaver.
  // Resolve that immutable provider identity and bootstrap only THEIR tenant.
  const spmt = await resolveSpmtIdentity(discordUserId);
  if (!spmt) return undefined;

  await bootstrapTenant(spmt.tenantId, spmt.username);
  await persistVerifiedDmBinding({
    tenantId: spmt.tenantId,
    discordUserId,
    discordUsername: spmt.discordUsername || discordUsername,
    channelId,
  });
  return { tenantId: spmt.tenantId, source: 'spmt-discord' };
}
