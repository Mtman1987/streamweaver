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

function getDiscordStreamHubUrl(): string {
  return (
    process.env.DISCORD_STREAM_HUB_URL ||
    process.env.NEXT_PUBLIC_DISCORD_STREAM_HUB_URL ||
    'https://discord-stream-hub-new.fly.dev'
  ).replace(/\/$/, '');
}

function getDiscordStreamHubSecret(): string {
  return process.env.BOT_SECRET_KEY || '';
}

async function postDiscordStreamHub<T>(path: string, payload: Record<string, unknown>): Promise<T> {
  const secret = getDiscordStreamHubSecret();
  const response = await fetch(`${getDiscordStreamHubUrl()}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(secret ? { Authorization: `Bearer ${secret}` } : {}),
    },
    body: JSON.stringify(payload),
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(`DiscordStreamHub ${path} failed: ${response.status} ${await response.text().catch(() => '')}`);
  }

  return response.json() as Promise<T>;
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
    console.warn('[DiscordStreamHub] Admin access check failed:', error);
    return null;
  }
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
