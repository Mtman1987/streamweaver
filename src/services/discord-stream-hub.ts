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

async function postDiscordStreamHub<T>(path: string, payload: Record<string, unknown>): Promise<T> {
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
    signal: createDiscordStreamHubAbortSignal(),
  });

  if (!response.ok) {
    const details = await readDiscordStreamHubErrorBody(response);
    throw new Error(`DiscordStreamHub ${path} failed: ${response.status}${details ? ` ${details}` : ''}`);
  }

  return response.json() as Promise<T>;
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
    rank?: number | null;
    username?: string;
    displayName?: string;
  }>('/api/points/balance', {
    userId: payload?.userId || context?.userId,
    username: payload?.username || context?.username,
    displayName: payload?.displayName || context?.displayName,
    serverId: payload?.serverId || context?.guildId,
  });

  return {
    points: Number(data.points || 0),
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

export async function checkDiscordStreamHubAdminAccess(payload: {
  serverId?: string;
  guildId?: string;
  userId?: string;
}): Promise<{ isAdmin: boolean; isMod: boolean; isOwner: boolean; matchedBy?: string | null } | null> {
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
  const data = await getDiscordStreamHub<{ members?: DiscordStreamHubCheckinMember[] }>(
    '/api/discord/checkin-members',
    { serverId, group },
  );
  return Array.isArray(data?.members) ? data.members : [];
}

export async function lookupDiscordStreamHubTwitchTarget(twitchLogin: string, serverId?: string): Promise<DiscordStreamHubClipLookup | null> {
  const trimmedLogin = String(twitchLogin || '').trim().toLowerCase();
  if (!trimmedLogin) return null;

  const url = new URL(`${getDiscordStreamHubUrl()}/api/clips/lookup`);
  url.searchParams.set('twitchLogin', trimmedLogin);
  if (serverId) url.searchParams.set('serverId', serverId);

  try {
    const response = await fetch(url.toString(), { cache: 'no-store' });
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
  username?: string;
  displayName?: string;
}>> {
  const data = await getDiscordStreamHub<Array<{
    id?: string;
    userProfileId?: string;
    points?: number;
    lastEventMetadata?: Record<string, unknown> | null;
  }>>('/api/points/leaderboard', {
    serverId: payload.serverId,
    limit: payload.limit,
  });

  return Array.isArray(data)
    ? data.map((entry) => ({
        userId: String(entry.userProfileId || entry.id || ''),
        points: Number(entry.points || 0),
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
