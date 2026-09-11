import { NextRequest, NextResponse } from 'next/server';
import { serializeSessionCookie, STREAMWEAVER_SESSION_MAX_AGE } from '@/lib/session-cookie';

const SPMT_BASE_URL = String(process.env.SPMT_BASE_URL || 'https://spmt.live').replace(/\/$/, '');

export type RefreshedSpmtConnection = {
  user?: any;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  refreshExpiresIn: number;
};

export async function refreshSpmtConnection(request: NextRequest): Promise<RefreshedSpmtConnection | null> {
  const refreshToken = request.cookies.get('streamweaver-spmt-refresh')?.value || '';
  const clientSecret = String(process.env.STREAMWEAVER_CLIENT_SECRET || '').trim();
  if (!refreshToken || !clientSecret) return null;

  const signal = typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
    ? AbortSignal.timeout(8000)
    : undefined;
  const response = await fetch(`${SPMT_BASE_URL}/api/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: 'streamweaver',
      client_secret: clientSecret,
    }),
    cache: 'no-store',
    signal,
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.access_token || !payload?.refresh_token) return null;
  return {
    user: payload.user,
    accessToken: String(payload.access_token),
    refreshToken: String(payload.refresh_token),
    expiresIn: Number(payload.expires_in || 7 * 24 * 60 * 60),
    refreshExpiresIn: Number(payload.refresh_expires_in || 30 * 24 * 60 * 60),
  };
}

export function spmtLocalSession(user: any): string {
  return serializeSessionCookie({
    id: String(user.twitchId || user.twitch_id || user.id),
    spmtUserId: String(user.id),
    identityProvider: 'spmt',
    username: String(user.twitchUsername || user.twitch_username || user.username),
    displayName: String(user.displayName || user.display_name || user.username),
    avatar: String(user.avatarUrl || user.avatar_url || ''),
    loginTime: Date.now(),
  });
}

export function applySpmtLocalSession(response: NextResponse, value: string) {
  response.cookies.set('streamweaver-session', value, { httpOnly: true, secure: true, sameSite: 'none', partitioned: true, path: '/', maxAge: STREAMWEAVER_SESSION_MAX_AGE });
}

export function clearSpmtSessionCookies(response: NextResponse) {
  const names = ['streamweaver-session', 'streamweaver-spmt-token', 'streamweaver-spmt-refresh', 'streamweaver-spmt-state'];
  for (const name of names) response.cookies.set(name, '', { path: '/', secure: true, sameSite: 'none', partitioned: true, maxAge: 0 });
  for (const name of names) response.headers.append('set-cookie', `${name}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=None`);
}

export function applyRefreshedSpmtCookies(response: NextResponse, refreshed: RefreshedSpmtConnection) {
  response.cookies.set('streamweaver-spmt-token', refreshed.accessToken, {
    httpOnly: true,
    secure: true,
    sameSite: 'none',
    partitioned: true,
    path: '/',
    maxAge: refreshed.expiresIn,
  });
  response.cookies.set('streamweaver-spmt-refresh', refreshed.refreshToken, {
    httpOnly: true,
    secure: true,
    sameSite: 'none',
    partitioned: true,
    path: '/',
    maxAge: refreshed.refreshExpiresIn,
  });
  if (refreshed.user?.id) applySpmtLocalSession(response, spmtLocalSession(refreshed.user));
  for (const name of ['streamweaver-spmt-token', 'streamweaver-spmt-refresh', ...(refreshed.user?.id ? ['streamweaver-session'] : [])]) {
    response.headers.append('set-cookie', `${name}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=None`);
  }
}
