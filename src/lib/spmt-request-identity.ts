import { NextRequest } from 'next/server';
import { serializeSessionCookie } from '@/lib/session-cookie';
const SPMT_BASE_URL = String(process.env.SPMT_BASE_URL || 'https://spmt.live').replace(/\/$/, '');

export type SpmtUser = {
  id: string;
  username: string;
  displayName?: string;
  display_name?: string;
  avatarUrl?: string;
  avatar_url?: string;
  twitchId?: string;
  twitch_id?: string;
  twitchUsername?: string;
  twitch_username?: string;
};


export function bearerToken(request: NextRequest): string {
  const header = String(request.headers.get('authorization') || '').trim();
  return /^Bearer\s+/i.test(header) ? header.replace(/^Bearer\s+/i, '').trim() : '';
}


export function firstString(...values: unknown[]): string {
  for (const value of values) {
    const normalized = String(value || '').trim();
    if (normalized) return normalized;
  }
  return '';
}


export async function resolveSpmtUser(token: string): Promise<SpmtUser | null> {
  const response = await fetch(`${SPMT_BASE_URL}/api/oauth/userinfo`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    cache: 'no-store',
    signal: typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(8000) : undefined,
  });
  if (response.status === 401 || response.status === 403) return null;
  if (!response.ok) throw new Error('SPMT identity service is temporarily unavailable');
  const payload = await response.json().catch(() => null) as any;
  const user = payload?.user || payload?.profile || payload;
  if (!user?.id || !user?.username) return null;
  return user as SpmtUser;
}

export function internalSessionCookie(user: SpmtUser, tenantOverride?: string) {
  const ownerTenantId = firstString(user.twitchId, user.twitch_id, user.id);
  const tenantId = firstString(tenantOverride, ownerTenantId);
  const username = firstString(user.twitchUsername, user.twitch_username, user.username);
  const displayName = firstString(user.displayName, user.display_name, username);
  const avatar = firstString(user.avatarUrl, user.avatar_url);
  const value = serializeSessionCookie({
    id: tenantId,
    spmtUserId: user.id,
    identityProvider: 'spmt',
    username,
    displayName,
    avatar,
    loginTime: Date.now(),
  });
  return {
    tenantId,
    ownerTenantId,
    username,
    displayName,
    header: `streamweaver-session=${encodeURIComponent(value)}`,
  };
}

