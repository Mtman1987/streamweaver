import { NextRequest, NextResponse } from 'next/server';
import { bootstrapTenant } from '@/lib/tenant';
import { serializeSessionCookie, STREAMWEAVER_SESSION_MAX_AGE } from '@/lib/session-cookie';

const SPMT_BASE_URL = String(process.env.SPMT_BASE_URL || 'https://spmt.live').replace(/\/$/, '');
const STREAMWEAVER_ORIGIN = 'https://streamweaver-new.fly.dev';
const ALLOWED_PARENT_ORIGINS = new Set([
  'https://spacemountain.live',
  'https://spacemountain-live.fly.dev',
]);

function setEmbedCookie(
  response: NextResponse,
  name: string,
  value: string,
  maxAge: number,
) {
  response.cookies.set(name, value, {
    httpOnly: true,
    secure: true,
    sameSite: 'none',
    partitioned: true,
    path: '/',
    maxAge,
  });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const code = String(body?.code || '').trim();
  const parentOrigin = String(body?.parentOrigin || '').trim();
  if (!code || !ALLOWED_PARENT_ORIGINS.has(parentOrigin)) {
    return NextResponse.json({ error: 'Invalid embed launch request' }, { status: 400 });
  }

  const clientSecret = String(process.env.STREAMWEAVER_CLIENT_SECRET || '').trim();
  if (!clientSecret) {
    return NextResponse.json({ error: 'StreamWeaver SPMT connection is not configured' }, { status: 503 });
  }

  const exchange = await fetch(`${SPMT_BASE_URL}/api/embed/exchange`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      code,
      client_id: 'streamweaver',
      client_secret: clientSecret,
      target_origin: STREAMWEAVER_ORIGIN,
    }),
    cache: 'no-store',
  });
  const payload = await exchange.json().catch(() => null);
  if (!exchange.ok || !payload?.access_token || !payload?.user?.id || !payload?.user?.username) {
    return NextResponse.json(
      { error: payload?.error || 'SPMT embed exchange failed' },
      { status: exchange.status || 401 },
    );
  }

  const user = payload.user;
  const tenantId = String(user.twitchId || user.twitch_id || user.id);
  const username = String(user.twitchUsername || user.twitch_username || user.username);
  await bootstrapTenant(tenantId, username);

  const response = NextResponse.json({
    ok: true,
    connected: true,
    user: {
      id: String(user.id),
      username,
      displayName: String(user.displayName || user.display_name || username),
    },
    scopes: Array.isArray(payload.scopes) ? payload.scopes : [],
  });
  setEmbedCookie(response, 'streamweaver-session', serializeSessionCookie({
    id: tenantId,
    spmtUserId: String(user.id),
    identityProvider: 'spmt-embed',
    username,
    displayName: String(user.displayName || user.display_name || username),
    avatar: String(user.avatarUrl || user.avatar_url || ''),
    loginTime: Date.now(),
  }), STREAMWEAVER_SESSION_MAX_AGE);
  setEmbedCookie(
    response,
    'streamweaver-spmt-token',
    String(payload.access_token),
    Number(payload.expires_in || 7 * 24 * 60 * 60),
  );
  if (payload.refresh_token) {
    setEmbedCookie(
      response,
      'streamweaver-spmt-refresh',
      String(payload.refresh_token),
      Number(payload.refresh_expires_in || 30 * 24 * 60 * 60),
    );
  }
  return response;
}
