import { getChatOutputContext } from './chat-output-context';

type DiscordStreamHubPointsPayload = {
  userId: string;
  username?: string;
  displayName?: string;
  serverId?: string;
};

type DiscordStreamHubPointsSetPayload = DiscordStreamHubPointsPayload & {
  points: number;
};

type DiscordStreamHubActivityPayload = {
  userId: string;
  serverId?: string;
};

type DiscordStreamHubClipLookup = {
  found: boolean;
  serverId?: string;
  twitchLogin?: string;
  discordUserId?: string;
  isLive?: boolean;
};

type DiscordStreamHubManualShoutoutPayload = {
  serverId?: string;
  guildId?: string;
  channelId: string;
  requesterName: string;
  requesterDiscordId?: string;
  targetName?: string;
  targetDiscordUserId?: string;
  sourceMessageId?: string;
};

export type DiscordStreamHubCheckinMember = {
  id: string;
  discordUserId: string;
  username: string;
  displayName: string;
  twitchLogin: string;
  avatarUrl: string;
  group: string;
};

let cachedDefaultGuildId: string | null = null;
const checkinMemberCache = new Map<string, { members: DiscordStreamHubCheckinMember[]; expiresAt: number }>();

function getDiscordStreamHubUrl(): string {
  return (
    process.env.DISCORD_STREAM_HUB_URL ||
    process.env.NEXT_PUBLIC_DISCORD_STREAM_HUB_URL ||
    'https://discord-stream-hub-new.fly.dev'
  ).replace(/\/$/, '');
}

function getDiscordStreamHubSecret(): string {
  return process.env.DSH_SERVICE_SECRET || process.env.DSH_CLIENT_SECRET || process.env.BOT_SECRET_KEY || '';
}

function truncateDiscordStreamHubErrorBody(body: string): string {
  const compact = String(body || '').replace(/\s+/g, ' ').trim();
  if (!compact) return '';
  return compact.length > 160 ? `${compact.slice(0, 157)}...` : compact;
}

async function readDiscordStreamHubErrorBody(response: Response): Promise<string> {
  const contentType = String(response.headers.get('content-type') || '').toLowerCase();
  const text = await response.text().catch(() => '');
  if (!text) return '';
  if (contentType.includes('text/html')) return '[html response]';
  return truncateDiscordStreamHubErrorBody(text);
}

function createDiscordStreamHubAbortSignal(timeoutMs = 8000): AbortSignal | undefined {
  if (typeof AbortSignal === 'undefined' || typeof AbortSignal.timeout !== 'function') return undefined;
  return AbortSignal.timeout(timeoutMs);
}

async function postDiscordStreamHub<T>(path: string, payload: Record<string, unknown>, timeoutMs = 8000): Promise<T> {
  const secret = getDiscordStreamHubSecret();
  if (!secret) throw new Error('DSH_SERVICE_SECRET is not configured');
  const response = await fetch(`${getDiscordStreamHubUrl()}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(secret ? { Authorization: `Bearer ${secret}` } : {}),
    },
    body: JSON.stringify(payload),
    cache: 'no-store',
    signal: createDiscordStreamHubAbortSignal(timeoutMs),
  });

  if (!response.ok) {
    const details = await readDiscordStreamHubErrorBody(response);
    throw new Error(`DiscordStreamHub ${path} failed: ${response.status}${details ? ` ${details}` : ''}`);
  }

  return response.json() as Promise<T>;
}

export async function convertDiscordStreamHubMp4ToGif(input: {
  bytes: Buffer;
  fileName?: string;
  sessionToken: string;
  slot: 'avatar-idle' | 'avatar-talking' | 'private-dm' | 'public-discord';
}): Promise<{ url: string; bytes?: number }> {
  const sessionToken = String(input.sessionToken || '').trim();
  if (!sessionToken) throw new Error('A signed-in StreamWeaver session is required');
  const formData = new FormData();
  formData.append('file', new Blob([new Uint8Array(input.bytes)], { type: 'video/mp4' }), input.fileName || 'upload.mp4');
  formData.append('slot', input.slot);
  const response = await fetch(`${getDiscordStreamHubUrl()}/api/media/convert-gif`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${sessionToken}` },
    body: formData,
    cache: 'no-store',
    signal: createDiscordStreamHubAbortSignal(180_000),
  });
  if (!response.ok) {
    const details = await readDiscordStreamHubErrorBody(response);
    throw new Error(`DiscordStreamHub GIF conversion failed: ${response.status}${details ? ` ${details}` : ''}`);
  }
  const data = await response.json().catch(() => null) as any;
  const url = String(data?.url || '').trim();
  if (!/^https?:\/\//i.test(url)) throw new Error('DiscordStreamHub GIF conversion returned no public URL');
  return { url, bytes: Number(data?.bytes) || undefined };
}

async function getDiscordStreamHub<T>(path: string, searchParams?: Record<string, string | number | undefined>): Promise<T> {
  const secret = getDiscordStreamHubSecret();
  if (!secret) throw new Error('DSH_SERVICE_SECRET is not configured');
  const url = new URL(`${getDiscordStreamHubUrl()}${path}`);
  Object.entries(searchParams || {}).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    url.searchParams.set(key, String(value));
  });

  const response = await fetch(url.toString(), {
    headers: {
      ...(secret ? { Authorization: `Bearer ${secret}` } : {}),
    },
    cache: 'no-store',
    signal: createDiscordStreamHubAbortSignal(),
  });

  if (!response.ok) {
    const details = await readDiscordStreamHubErrorBody(response);
    throw new Error(`DiscordStreamHub ${path} failed: ${response.status}${details ? ` ${details}` : ''}`);
  }

  return response.json() as Promise<T>;
}

export async function getDiscordStreamHubDefaultGuildId(): Promise<string> {
  if (cachedDefaultGuildId) return cachedDefaultGuildId;

  const response = await fetch(`${getDiscordStreamHubUrl()}/api/runtime-config`, {
    cache: 'no-store',
    signal: createDiscordStreamHubAbortSignal(),
  });
  if (!response.ok) {
    const details = await readDiscordStreamHubErrorBody(response);
    throw new Error(`DiscordStreamHub runtime config failed: ${response.status}${details ? ` ${details}` : ''}`);
  }

  const data = await response.json().catch(() => null) as any;
  const guildId = String(data?.publicIds?.hardcodedGuildId || '').trim();
  if (!guildId) throw new Error('DiscordStreamHub runtime config does not define the Space Mountain server ID');

  cachedDefaultGuildId = guildId;
  return guildId;
}

export function getDiscordPointsContext() {
  const output = getChatOutputContext();
  if (!output || output.platform !== 'discord' || !output.userId) return null;
  return output;
}

export async function getDiscordStreamHubPoints(payload?: Partial<DiscordStreamHubPointsPayload>): Promise<{
  points: number;
  currentPoints: number;
  lifetimePoints: number;
  rank?: number | null;
  username?: string;
  displayName?: string;
}> {
  const context = getDiscordPointsContext();
  if (!context && !payload?.userId) {
    throw new Error('DiscordStreamHub points lookup requires a Discord user context');
  }

  const data = await postDiscordStreamHub<{
    points?: number;
    currentPoints?: number;
    lifetimePoints?: number;
    rank?: number | null;
    username?: string;
    displayName?: string;
  }>('/api/points/balance', {
    userId: payload?.userId || context?.userId,
    username: payload?.username || context?.username,
    displayName: payload?.displayName || context?.displayName,
    serverId: payload?.serverId || context?.guildId,
  });

  const points = Number(data.points || 0);
  return {
    points,
    currentPoints: Number(data.currentPoints ?? points),
    lifetimePoints: Number(data.lifetimePoints ?? points),
    rank: data.rank ?? null,
    username: data.username,
    displayName: data.displayName,
  };
}

export async function setDiscordStreamHubPoints(payload: DiscordStreamHubPointsSetPayload): Promise<{
  points: number;
}> {
  const data = await postDiscordStreamHub<{ points?: number }>('/api/points/set', payload);
  return {
    points: Number(data.points || payload.points || 0),
  };
}

/**
 * Settles a wager against the canonical SPMT wallet: the stake leaves spendable
 * XP, a win refills spendable up to lifetime, and anything above that ceiling is
 * compressed 10:1 before it can raise the lifetime rank.
 */
export async function settleDiscordStreamHubGamble(payload: {
  wager: number;
  payout: number;
  idempotencyKey: string;
  eventType?: string;
  userId?: string;
  username?: string;
  displayName?: string;
  serverId?: string;
  metadata?: Record<string, unknown>;
}): Promise<{
  points: number;
  currentPoints: number;
  lifetimePoints: number;
  rank: number | null;
  duplicate: boolean;
  source: 'spmt' | 'legacy';
}> {
  const context = getDiscordPointsContext();
  const data = await postDiscordStreamHub<{
    points?: number;
    currentPoints?: number;
    lifetimePoints?: number;
    rank?: number | null;
    duplicate?: boolean;
    source?: 'spmt' | 'legacy';
  }>('/api/points/gamble-settle', {
    ...payload,
    userId: payload.userId || context?.userId,
    username: payload.username || context?.username,
    displayName: payload.displayName || context?.displayName,
    serverId: payload.serverId || context?.guildId,
  });

  const points = Number(data.points || 0);
  return {
    points,
    currentPoints: Number(data.currentPoints ?? points),
    lifetimePoints: Number(data.lifetimePoints ?? points),
    rank: data.rank ?? null,
    duplicate: Boolean(data.duplicate),
    source: data.source === 'legacy' ? 'legacy' : 'spmt',
  };
}

export async function addDiscordStreamHubPointsToAll(payload: { points: number; serverId?: string }): Promise<{
  count: number;
}> {
  const context = getDiscordPointsContext();
  const data = await postDiscordStreamHub<{ count?: number }>('/api/points/add-to-all', {
    points: payload.points,
    serverId: payload.serverId || context?.guildId,
  });
  return {
    count: Number(data.count || 0),
  };
}

export async function setDiscordStreamHubPointsToAll(payload: { points: number; serverId?: string }): Promise<{
  count: number;
}> {
  const context = getDiscordPointsContext();
  const data = await postDiscordStreamHub<{ count?: number }>('/api/points/set-to-all', {
    points: payload.points,
    serverId: payload.serverId || context?.guildId,
  });
  return {
    count: Number(data.count || 0),
  };
}

const PUBLIC_DISCORD_COMMANDS = new Set([
  'points', 'leader', 'pleader', 'wleader', 'cleader', 'bleader', 'bitsleader',
  'gamble', 'roll', 'double', 'coinflip', 'watchtime', 'uptime', 'followers',
  'stats', 'time', 'commands', 'pack', 'collection', 'show', 'deck', 'challenge',
]);

function isPublicDiscordCommandContext(): boolean {
  const context = getChatOutputContext();
  if (!context || context.platform !== 'discord') return false;
  const message = String(context.messageContent || '').trim();
  if (!message.startsWith('!')) return false;
  const command = message.slice(1).split(/\s+/)[0]?.toLowerCase() || '';
  return PUBLIC_DISCORD_COMMANDS.has(command);
}

export async function checkDiscordStreamHubAdminAccess(payload: {
  serverId?: string;
  guildId?: string;
  userId?: string;
}): Promise<{ isAdmin: boolean; isMod: boolean; isOwner: boolean; matchedBy?: string | null } | null> {
  if (isPublicDiscordCommandContext()) return null;

  const serverId = String(payload.serverId || payload.guildId || '').trim();
  const userId = String(payload.userId || '').trim();
  if (!serverId || !userId) return null;

  try {
    const data = await postDiscordStreamHub<{
      isAdmin?: boolean;
      isMod?: boolean;
      isOwner?: boolean;
      matchedBy?: string | null;
    }>('/api/admin/access', { serverId, userId });
    return {
      isAdmin: Boolean(data.isAdmin),
      isMod: Boolean(data.isMod),
      isOwner: Boolean(data.isOwner),
      matchedBy: data.matchedBy ?? null,
    };
  } catch (error) {
    console.warn('[DiscordStreamHub] Admin access check failed:', error instanceof Error ? error.message : String(error));
    return null;
  }
}

export async function getDiscordStreamHubCheckinMembers(serverId: string, group?: string): Promise<DiscordStreamHubCheckinMember[]> {
  if (!serverId) throw new Error('DiscordStreamHub check-in member lookup requires a server ID');
  const cacheKey = `${serverId}:${group || ''}`;
  const cached = checkinMemberCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.members;
  const data = await getDiscordStreamHub<{ members?: DiscordStreamHubCheckinMember[] }>(
    '/api/discord/checkin-members',
    { serverId, group },
  );
  const members = Array.isArray(data?.members) ? data.members : [];
  checkinMemberCache.set(cacheKey, { members, expiresAt: Date.now() + 5 * 60 * 1000 });
  return members;
}

export async function resolveDiscordStreamHubTwitchIdentity(
  discordUserId: string,
  serverId: string,
): Promise<DiscordStreamHubCheckinMember | null> {
  const normalizedId = String(discordUserId || '').trim();
  if (!normalizedId || !serverId) return null;
  const members = await getDiscordStreamHubCheckinMembers(serverId);
  return members.find((member) =>
    String(member.discordUserId || member.id || '').trim() === normalizedId &&
    Boolean(String(member.twitchLogin || '').trim())
  ) || null;
}

export async function lookupDiscordStreamHubTwitchTarget(twitchLogin: string, serverId?: string): Promise<DiscordStreamHubClipLookup | null> {
  const trimmedLogin = String(twitchLogin || '').trim().toLowerCase();
  if (!trimmedLogin) return null;

  const url = new URL(`${getDiscordStreamHubUrl()}/api/clips/lookup`);
  url.searchParams.set('twitchLogin', trimmedLogin);
  if (serverId) url.searchParams.set('serverId', serverId);

  try {
    const response = await fetch(url.toString(), {
      cache: 'no-store',
      signal: createDiscordStreamHubAbortSignal(),
    });
    if (!response.ok) return null;
    return await response.json().catch(() => null);
  } catch {
    return null;
  }
}

export async function createDiscordStreamHubManualShoutout(payload: DiscordStreamHubManualShoutoutPayload): Promise<{
  success: boolean;
  messageId?: string | null;
  isLive?: boolean;
  twitchLogin?: string;
}> {
  const data = await postDiscordStreamHub<{
    success?: boolean;
    messageId?: string | null;
    isLive?: boolean;
    twitchLogin?: string;
  }>('/api/discord/manual-shoutout', payload);
  return {
    success: Boolean(data?.success),
    messageId: data?.messageId ?? null,
    isLive: data?.isLive,
    twitchLogin: data?.twitchLogin,
  };
}

export async function getDiscordStreamHubActivitySummary(payload: DiscordStreamHubActivityPayload): Promise<{
  found: boolean;
  summary?: {
    messageCount: number;
    voiceMinutes: number;
    helpfulReactions: number;
    streamAttendance: number;
    activeDays: number;
    firstSeenAt: string | null;
    lastSeenAt: string | null;
    lastSeenChannelId: string | null;
    lastSeenChannelName: string | null;
    username?: string;
    displayName?: string;
    avatarUrl?: string;
  } | null;
}> {
  const data = await postDiscordStreamHub<{
    found?: boolean;
    summary?: {
      messageCount?: number;
      voiceMinutes?: number;
      helpfulReactions?: number;
      streamAttendance?: number;
      activeDays?: number;
      firstSeenAt?: string | null;
      lastSeenAt?: string | null;
      lastSeenChannelId?: string | null;
      lastSeenChannelName?: string | null;
      username?: string;
      displayName?: string;
      avatarUrl?: string;
    } | null;
  }>('/api/discord/activity/user', payload);

  return {
    found: Boolean(data.found),
    summary: data.summary
      ? {
          messageCount: Number(data.summary.messageCount || 0),
          voiceMinutes: Number(data.summary.voiceMinutes || 0),
          helpfulReactions: Number(data.summary.helpfulReactions || 0),
          streamAttendance: Number(data.summary.streamAttendance || 0),
          activeDays: Number(data.summary.activeDays || 0),
          firstSeenAt: data.summary.firstSeenAt || null,
          lastSeenAt: data.summary.lastSeenAt || null,
          lastSeenChannelId: data.summary.lastSeenChannelId || null,
          lastSeenChannelName: data.summary.lastSeenChannelName || null,
          username: data.summary.username,
          displayName: data.summary.displayName,
          avatarUrl: data.summary.avatarUrl,
        }
      : null,
  };
}

export async function getDiscordStreamHubPointsLeaderboard(payload: { serverId?: string; limit?: number }): Promise<Array<{
  userId: string;
  points: number;
  currentPoints: number;
  lifetimePoints: number;
  rank?: number;
  username?: string;
  displayName?: string;
}>> {
  const data = await getDiscordStreamHub<Array<{
    id?: string;
    userProfileId?: string;
    rank?: number;
    points?: number;
    currentPoints?: number;
    lifetimePoints?: number;
    lastEventMetadata?: Record<string, unknown> | null;
  }>>('/api/points/leaderboard', {
    serverId: payload.serverId,
    limit: payload.limit,
  });

  return Array.isArray(data)
    ? data.map((entry, index) => ({
        userId: String(entry.userProfileId || entry.id || ''),
        points: Number(entry.points || 0),
        currentPoints: Number(entry.currentPoints ?? entry.points ?? 0),
        lifetimePoints: Number(entry.lifetimePoints ?? entry.points ?? 0),
        rank: Number(entry.rank || index + 1),
        username: typeof entry.lastEventMetadata?.username === 'string' ? entry.lastEventMetadata.username : undefined,
        displayName: typeof entry.lastEventMetadata?.displayName === 'string' ? entry.lastEventMetadata.displayName : undefined,
      }))
    : [];
}

export async function getDiscordStreamHubActivityLeaderboard(payload: { serverId?: string; limit?: number }): Promise<Array<{
  userId: string;
  username?: string;
  displayName?: string;
  messageCount: number;
  voiceMinutes: number;
  helpfulReactions: number;
  streamAttendance: number;
  activeDays: number;
  activityScore: number;
}>> {
  const data = await postDiscordStreamHub<Array<{
    userId?: string;
    username?: string;
    displayName?: string;
    messageCount?: number;
    voiceMinutes?: number;
    helpfulReactions?: number;
    streamAttendance?: number;
    activeDays?: number;
    activityScore?: number;
  }>>('/api/discord/activity/leaderboard', payload);

  return Array.isArray(data)
    ? data.map((entry) => ({
        userId: String(entry.userId || ''),
        username: entry.username,
        displayName: entry.displayName,
        messageCount: Number(entry.messageCount || 0),
        voiceMinutes: Number(entry.voiceMinutes || 0),
        helpfulReactions: Number(entry.helpfulReactions || 0),
        streamAttendance: Number(entry.streamAttendance || 0),
        activeDays: Number(entry.activeDays || 0),
        activityScore: Number(entry.activityScore || 0),
      }))
    : [];
}


export type DiscordStreamHubTenantPoints = {
  tenantId: string;
  tenantName: string;
  currentPoints: number;
  lifetimePoints: number;
  rank?: number | null;
  isCurrent?: boolean;
};

export async function getDiscordStreamHubTenantPoints(payload: DiscordStreamHubPointsPayload): Promise<{
  tenants: DiscordStreamHubTenantPoints[];
  totalCurrentPoints: number;
  totalLifetimePoints: number;
}> {
  try {
    const data = await postDiscordStreamHub<{
      tenants?: Array<{
        tenantId?: string;
        serverId?: string;
        tenantName?: string;
        streamerName?: string;
        currentPoints?: number;
        lifetimePoints?: number;
        points?: number;
        rank?: number | null;
      }>;
    }>('/api/points/tenant-balances', payload);
    const tenants = (Array.isArray(data.tenants) ? data.tenants : []).map((entry) => ({
      tenantId: String(entry.tenantId || entry.serverId || ''),
      tenantName: String(entry.tenantName || entry.streamerName || 'Unknown streamer'),
      currentPoints: Number(entry.currentPoints ?? entry.points ?? 0),
      lifetimePoints: Number(entry.lifetimePoints ?? entry.points ?? 0),
      rank: entry.rank ?? null,
      isCurrent: Boolean(payload.serverId && (entry.serverId === payload.serverId || entry.tenantId === payload.serverId)),
    }));
    return {
      tenants,
      totalCurrentPoints: tenants.reduce((total, entry) => total + entry.currentPoints, 0),
      totalLifetimePoints: tenants.reduce((total, entry) => total + entry.lifetimePoints, 0),
    };
  } catch {
    const balance = await getDiscordStreamHubPoints(payload);
    const tenantName = payload.serverId || 'Current streamer';
    return {
      tenants: [{
        tenantId: payload.serverId || '',
        tenantName,
        currentPoints: balance.currentPoints,
        lifetimePoints: balance.lifetimePoints,
        rank: balance.rank,
        isCurrent: true,
      }],
      totalCurrentPoints: balance.currentPoints,
      totalLifetimePoints: balance.lifetimePoints,
    };
  }
}

export type DiscordStreamHubTenantActivity = {
  tenantId: string;
  tenantName: string;
  watchMinutes: number;
  messageCount: number;
  activeDays: number;
  isCurrent?: boolean;
};

export async function getDiscordStreamHubTenantActivity(payload: DiscordStreamHubActivityPayload): Promise<{
  tenants: DiscordStreamHubTenantActivity[];
  totalWatchMinutes: number;
}> {
  try {
    const data = await postDiscordStreamHub<{
      tenants?: Array<{
        tenantId?: string;
        serverId?: string;
        tenantName?: string;
        streamerName?: string;
        watchMinutes?: number;
        voiceMinutes?: number;
        messageCount?: number;
        activeDays?: number;
      }>;
    }>('/api/discord/activity/tenant-summary', payload);
    const tenants = (Array.isArray(data.tenants) ? data.tenants : []).map((entry) => ({
      tenantId: String(entry.tenantId || entry.serverId || ''),
      tenantName: String(entry.tenantName || entry.streamerName || 'Unknown streamer'),
      watchMinutes: Number(entry.watchMinutes ?? entry.voiceMinutes ?? 0),
      messageCount: Number(entry.messageCount || 0),
      activeDays: Number(entry.activeDays || 0),
      isCurrent: Boolean(payload.serverId && (entry.serverId === payload.serverId || entry.tenantId === payload.serverId)),
    }));
    return {
      tenants,
      totalWatchMinutes: tenants.reduce((total, entry) => total + entry.watchMinutes, 0),
    };
  } catch {
    const result = await getDiscordStreamHubActivitySummary(payload);
    const summary = result.summary;
    return {
      tenants: summary ? [{
        tenantId: payload.serverId || '',
        tenantName: payload.serverId || 'Current streamer',
        watchMinutes: summary.voiceMinutes,
        messageCount: summary.messageCount,
        activeDays: summary.activeDays,
        isCurrent: true,
      }] : [],
      totalWatchMinutes: Number(summary?.voiceMinutes || 0),
    };
  }
}

export async function getDiscordStreamHubLeaderboardPost(payload: {
  serverId?: string;
  userId?: string;
  limit?: number;
}): Promise<{
  title: string;
  imageUrl?: string;
  scope?: string;
  updatedAt?: string;
  rankButtonCustomId: string;
}> {
  const data = await postDiscordStreamHub<{
    title?: string;
    imageUrl?: string;
    leaderboardImageUrl?: string;
    scope?: string;
    updatedAt?: string;
    rankButtonCustomId?: string;
  }>('/api/leaderboard/render', payload, 55_000);
  return {
    title: data.title || 'DiscordStreamHub Leaderboard',
    imageUrl: data.imageUrl || data.leaderboardImageUrl,
    scope: data.scope,
    updatedAt: data.updatedAt,
    rankButtonCustomId: data.rankButtonCustomId || `sw_dsh_rank:${payload.serverId || 'global'}`,
  };
}
