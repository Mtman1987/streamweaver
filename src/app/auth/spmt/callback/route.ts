import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getConfiguredAppUrl } from '@/lib/runtime-origin';
import { bootstrapTenant } from '@/lib/tenant';
import { serializeSessionCookie, STREAMWEAVER_SESSION_MAX_AGE } from '@/lib/session-cookie';

const SPMT_BASE_URL = String(process.env.SPMT_BASE_URL || 'https://spmt.live').replace(/\/$/, '');

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(request: NextRequest) {
  const appOrigin = getConfiguredAppUrl(request.nextUrl.origin);
  const redirectUri = `${appOrigin}/auth/spmt/callback`;
  const state = String(request.nextUrl.searchParams.get('state') || '');
  const code = String(request.nextUrl.searchParams.get('code') || '');
  const expectedState = request.cookies.get('streamweaver-spmt-state')?.value || '';
  const clientSecret = String(process.env.STREAMWEAVER_CLIENT_SECRET || '').trim();

  if (!state || !code || !expectedState || !safeEqual(state, expectedState)) {
    console.warn('[SPMT OAuth] Callback state rejected', {
      hasState: Boolean(state),
      hasCode: Boolean(code),
      hasExpectedState: Boolean(expectedState),
      stateMatched: Boolean(state && expectedState && safeEqual(state, expectedState)),
    });
    return NextResponse.redirect(`${appOrigin}/login?error=invalid_spmt_state`);
  }
  if (!clientSecret) {
    return NextResponse.redirect(`${appOrigin}/login?error=spmt_not_configured`);
  }

  const exchange = await fetch(`${SPMT_BASE_URL}/api/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code,
      client_id: 'streamweaver',
      client_secret: clientSecret,
      redirect_uri: redirectUri,
    }),
    cache: 'no-store',
  });
  const tokenPayload = await exchange.json().catch(() => ({}));
  if (!exchange.ok || !tokenPayload?.access_token) {
    console.error('[SPMT OAuth] Token exchange failed', { status: exchange.status, error: tokenPayload?.error || null });
    return NextResponse.redirect(`${appOrigin}/login?error=spmt_exchange_failed`);
  }

  const userResponse = await fetch(`${SPMT_BASE_URL}/api/oauth/userinfo`, {
    headers: { Authorization: `Bearer ${tokenPayload.access_token}` },
    cache: 'no-store',
  });
  const user = await userResponse.json().catch(() => null);
  if (!userResponse.ok || !user?.id || !user?.username) {
    console.error('[SPMT OAuth] User profile lookup failed', { status: userResponse.status });
    return NextResponse.redirect(`${appOrigin}/login?error=spmt_profile_failed`);
  }

  // Preserve existing Twitch-owned tenant storage when the canonical account has
  // a verified Twitch link. Discord-only accounts receive a stable SPMT tenant.
  const tenantId = String(user.twitchId || user.twitch_id || user.id);
  await bootstrapTenant(tenantId, String(user.twitchUsername || user.twitch_username || user.username));

  const response = NextResponse.redirect(`${appOrigin}/dashboard`);
  response.cookies.set('streamweaver-session', serializeSessionCookie({
    id: tenantId,
    spmtUserId: String(user.id),
    identityProvider: 'spmt',
    username: String(user.twitchUsername || user.twitch_username || user.username),
    displayName: String(user.displayName || user.display_name || user.username),
    avatar: String(user.avatarUrl || user.avatar_url || ''),
    loginTime: Date.now(),
  }), {
    httpOnly: true,
    secure: appOrigin.startsWith('https://'),
    sameSite: 'lax',
    path: '/',
    maxAge: STREAMWEAVER_SESSION_MAX_AGE,
  });
  response.cookies.set('streamweaver-spmt-token', String(tokenPayload.access_token), {
    httpOnly: true,
    secure: appOrigin.startsWith('https://'),
    sameSite: 'lax',
    path: '/',
    maxAge: 7 * 24 * 60 * 60,
  });
  response.cookies.delete('streamweaver-spmt-state');
  console.info('[SPMT OAuth] Login session issued', { tenantId, spmtUserId: String(user.id) });
  return response;
}
