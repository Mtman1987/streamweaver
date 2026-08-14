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

function appCookieOptions(appOrigin: string, maxAge: number) {
  const secure = appOrigin.startsWith('https://');
  return {
    httpOnly: true,
    secure,
    sameSite: secure ? 'none' as const : 'lax' as const,
    path: '/',
    maxAge,
  };
}

export async function GET(request: NextRequest) {
  const appOrigin = getConfiguredAppUrl(request.nextUrl.origin);
  const redirectUri = `${appOrigin}/auth/spmt/callback`;
  const state = String(request.nextUrl.searchParams.get('state') || '');
  const code = String(request.nextUrl.searchParams.get('code') || '');
  const expectedState = request.cookies.get('streamweaver-spmt-state')?.value || '';
  const requestedNext = request.cookies.get('streamweaver-spmt-next')?.value || '/dashboard';
  const nextPath = requestedNext.startsWith('/') && !requestedNext.startsWith('//')
    ? requestedNext
    : '/dashboard';
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

  // SPMT's authorization-code exchange already returns the canonical user. Use
  // that identity directly instead of adding a second cross-service userinfo
  // request to every login. The stored access token remains available for later
  // permissioned SPMT calls and can still be validated by those endpoints.
  const user = tokenPayload?.user;
  if (!user?.id || !user?.username) {
    console.error('[SPMT OAuth] Token exchange did not include the canonical user');
    return NextResponse.redirect(`${appOrigin}/login?error=spmt_profile_failed`);
  }

  // Preserve existing Twitch-owned tenant storage when the canonical account has
  // a verified Twitch link. Discord-only accounts receive a stable SPMT tenant.
  const tenantId = String(user.twitchId || user.twitch_id || user.id);
  await bootstrapTenant(tenantId, String(user.twitchUsername || user.twitch_username || user.username));

  const response = NextResponse.redirect(`${appOrigin}${nextPath}`);
  response.cookies.set('streamweaver-session', serializeSessionCookie({
    id: tenantId,
    spmtUserId: String(user.id),
    identityProvider: 'spmt',
    username: String(user.twitchUsername || user.twitch_username || user.username),
    displayName: String(user.displayName || user.display_name || user.username),
    avatar: String(user.avatarUrl || user.avatar_url || ''),
    loginTime: Date.now(),
  }), appCookieOptions(appOrigin, STREAMWEAVER_SESSION_MAX_AGE));
  response.cookies.set('streamweaver-spmt-token', String(tokenPayload.access_token), appCookieOptions(appOrigin, Number(tokenPayload.expires_in || 7 * 24 * 60 * 60)));
  if (tokenPayload.refresh_token) {
    response.cookies.set('streamweaver-spmt-refresh', String(tokenPayload.refresh_token), appCookieOptions(appOrigin, Number(tokenPayload.refresh_expires_in || 30 * 24 * 60 * 60)));
  }
  response.cookies.delete('streamweaver-spmt-state');
  response.cookies.delete('streamweaver-spmt-next');
  console.info('[SPMT OAuth] Login session issued', { tenantId, spmtUserId: String(user.id) });
  return response;
}
