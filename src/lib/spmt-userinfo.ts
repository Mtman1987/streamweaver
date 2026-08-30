import { NextRequest } from 'next/server';

const SPMT_BASE_URL = String(process.env.SPMT_BASE_URL || 'https://spmt.live').replace(/\/$/, '');

export type SpmtDiscordIdentity = {
  discordUserId: string;
  discordUsername: string;
  isAdmin: boolean;
};

function firstString(...values: unknown[]): string {
  for (const value of values) {
    const normalized = String(value || '').trim();
    if (normalized) return normalized;
  }
  return '';
}

function spmtIdentityIsAdmin(user: any): boolean {
  if (user?.isAdmin === true || user?.is_admin === true || user?.is_admin === 1) return true;
  const role = firstString(user?.role).toLowerCase();
  if (role === 'admin' || role === 'owner') return true;
  const roles = Array.isArray(user?.roles)
    ? user.roles.map((value: unknown) => firstString(value).toLowerCase())
    : [];
  return roles.includes('admin') || roles.includes('owner');
}

export async function getSpmtDiscordIdentity(request: NextRequest): Promise<SpmtDiscordIdentity | null> {
  const accessToken = String(request.cookies.get('streamweaver-spmt-token')?.value || '').trim();
  if (!accessToken) return null;

  const response = await fetch(`${SPMT_BASE_URL}/api/oauth/userinfo`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
  });
  if (!response.ok) return null;

  const payload = await response.json().catch(() => null) as any;
  const user = payload?.user || payload?.profile || payload;
  const discord = user?.discord || user?.identities?.discord || {};
  const discordUserId = firstString(
    user?.discordUserId,
    user?.discord_user_id,
    user?.discordId,
    user?.discord_id,
    discord?.userId,
    discord?.user_id,
    discord?.id,
  );
  if (!/^\d{10,32}$/.test(discordUserId)) return null;

  return {
    discordUserId,
    discordUsername: firstString(
      user?.discordUsername,
      user?.discord_username,
      discord?.displayName,
      discord?.display_name,
      discord?.username,
    ),
    isAdmin: spmtIdentityIsAdmin(user),
  };
}
