import { NextRequest } from 'next/server';

const SPMT_BASE_URL = String(process.env.SPMT_BASE_URL || 'https://spmt.live').replace(/\/$/, '');

export type SpmtIdentity = Record<string, unknown> & {
  id?: string;
  username?: string;
  displayName?: string;
  display_name?: string;
  twitchId?: string;
  twitch_id?: string;
  twitchUsername?: string;
  twitch_username?: string;
  isAdmin?: boolean;
  is_admin?: boolean | number;
  role?: string;
  roles?: string[];
};

export type SpmtDiscordIdentity = {
  discordUserId: string;
  discordUsername: string;
};

export type SpmtAthenaActor = {
  userId: string;
  username: string;
  displayName: string;
  isOwner: boolean;
  isAdmin: boolean;
  isModerator: boolean;
};

function firstString(...values: unknown[]): string {
  for (const value of values) {
    const normalized = String(value || '').trim();
    if (normalized) return normalized;
  }
  return '';
}

function normalizedRoles(identity: SpmtIdentity): string[] {
  const roles = Array.isArray(identity.roles) ? identity.roles : [];
  return [identity.role, ...roles]
    .map((value) => String(value || '').trim().toLowerCase())
    .filter(Boolean);
}

export function readSpmtAccessToken(request: NextRequest): string {
  const authorization = String(request.headers.get('authorization') || '');
  const bearer = authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || '';
  return firstString(
    bearer,
    request.cookies.get('streamweaver-spmt-token')?.value,
    request.cookies.get('spmt_access_token')?.value,
    request.cookies.get('spmt_token')?.value,
  );
}

export function isSpmtOwner(identity: SpmtIdentity | null | undefined): boolean {
  if (!identity) return false;
  return normalizedRoles(identity).includes('owner');
}

export function isSpmtAdmin(identity: SpmtIdentity | null | undefined): boolean {
  if (!identity) return false;
  if (identity.isAdmin === true || identity.is_admin === true || identity.is_admin === 1) return true;
  const roles = normalizedRoles(identity);
  return roles.includes('owner') || roles.includes('admin');
}

export function getSpmtTenantId(identity: SpmtIdentity | null | undefined): string {
  if (!identity) return '';
  return firstString(
    identity.twitchId,
    identity.twitch_id,
    identity.userId,
    identity.user_id,
    identity.id,
  );
}

export function getSpmtAthenaActor(identity: SpmtIdentity): SpmtAthenaActor {
  const userId = getSpmtTenantId(identity) || firstString(identity.id);
  const username = firstString(
    identity.twitchUsername,
    identity.twitch_username,
    identity.username,
    identity.handle,
    userId,
  );
  const displayName = firstString(
    identity.displayName,
    identity.display_name,
    identity.twitchDisplayName,
    identity.twitch_display_name,
    username,
  );
  const roles = normalizedRoles(identity);
  return {
    userId,
    username,
    displayName,
    isOwner: isSpmtOwner(identity),
    isAdmin: isSpmtAdmin(identity),
    isModerator: roles.includes('moderator') || roles.includes('mod'),
  };
}

export async function getSpmtIdentity(request: NextRequest): Promise<SpmtIdentity | null> {
  const accessToken = readSpmtAccessToken(request);
  if (!accessToken) return null;

  const signal = typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
    ? AbortSignal.timeout(10_000)
    : undefined;
  const response = await fetch(`${SPMT_BASE_URL}/api/oauth/userinfo`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
    cache: 'no-store',
    signal,
  }).catch(() => null);
  if (!response?.ok) return null;

  const payload = await response.json().catch(() => null) as any;
  const identity = (payload?.user || payload?.profile || payload) as SpmtIdentity | null;
  return identity?.id ? identity : null;
}

export async function getSpmtDiscordIdentity(request: NextRequest): Promise<SpmtDiscordIdentity | null> {
  const user = await getSpmtIdentity(request);
  if (!user) return null;

  const discord = (user.discord || (user.identities as any)?.discord || {}) as Record<string, unknown>;
  const discordUserId = firstString(
    user.discordUserId,
    user.discord_user_id,
    user.discordId,
    user.discord_id,
    discord.userId,
    discord.user_id,
    discord.id,
  );
  if (!/^\d{10,32}$/.test(discordUserId)) return null;

  return {
    discordUserId,
    discordUsername: firstString(
      user.discordUsername,
      user.discord_username,
      discord.displayName,
      discord.display_name,
      discord.username,
    ),
  };
}
