import { NextRequest, NextResponse } from 'next/server';

const SPMT_BASE_URL = String(process.env.SPMT_BASE_URL || 'https://spmt.live').replace(/\/$/, '');

export type RefreshedSpmtConnection = {
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
    accessToken: String(payload.access_token),
    refreshToken: String(payload.refresh_token),
    expiresIn: Number(payload.expires_in || 7 * 24 * 60 * 60),
    refreshExpiresIn: Number(payload.refresh_expires_in || 30 * 24 * 60 * 60),
  };
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
}
