import { NextRequest, NextResponse } from 'next/server';
import { bootstrapTenant } from '@/lib/tenant';
import { serializeSessionCookie, STREAMWEAVER_SESSION_MAX_AGE } from '@/lib/session-cookie';

const SPMT_BASE_URL = String(process.env.SPMT_BASE_URL || 'https://spmt.live').replace(/\/$/, '');

function setSessionCookie(response: NextResponse, name: string, value: string, maxAge: number) {
  response.cookies.set(name, value, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge,
  });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const token = String(body?.token || '').trim();
  if (!token || token.length > 8192) {
    return NextResponse.json({ error: 'A valid Companion tenant session is required' }, { status: 400 });
  }

  const identityResponse = await fetch(`${SPMT_BASE_URL}/api/me`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    cache: 'no-store',
  });
  const payload = await identityResponse.json().catch(() => null);
  const user = payload?.user;
  if (!identityResponse.ok || !user?.id || !user?.username) {
    return NextResponse.json({ error: 'The Companion tenant session is invalid or expired' }, { status: 401 });
  }

  const tenantId = String(user.twitchId || user.twitch_id || user.id);
  const username = String(user.twitchUsername || user.twitch_username || user.username);
  await bootstrapTenant(tenantId, username);

  const response = NextResponse.json({
    ok: true,
    connected: true,
    tenantId,
    user: {
      id: String(user.id),
      username,
      displayName: String(user.displayName || user.display_name || username),
    },
  });
  setSessionCookie(response, 'streamweaver-session', serializeSessionCookie({
    id: tenantId,
    spmtUserId: String(user.id),
    identityProvider: 'spmt-companion',
    username,
    displayName: String(user.displayName || user.display_name || username),
    avatar: String(user.avatarUrl || user.avatar_url || ''),
    loginTime: Date.now(),
  }), STREAMWEAVER_SESSION_MAX_AGE);
  setSessionCookie(response, 'streamweaver-spmt-token', token, STREAMWEAVER_SESSION_MAX_AGE);
  return response;
}
