import { NextRequest, NextResponse } from 'next/server';
import { getConfiguredAppUrl } from '@/lib/runtime-origin';
import { serializeSessionCookie, STREAMWEAVER_SESSION_MAX_AGE } from '@/lib/session-cookie';

const SPMT_BASE_URL = String(process.env.SPMT_BASE_URL || 'https://spmt.live').replace(/\/$/, '');

function safeNextPath(value: string | null): string {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '/dashboard';
  return value;
}

export async function GET(request: NextRequest) {
  const appOrigin = getConfiguredAppUrl(request.nextUrl.origin);
  const loginUrl = new URL('/login?error=legacy_session_migration_failed', appOrigin);
  const legacyCookie = request.cookies.get('streamweaver-session')?.value;
  const spmtToken = request.cookies.get('streamweaver-spmt-token')?.value;
  if (!legacyCookie?.startsWith('{') || !spmtToken) return NextResponse.redirect(loginUrl);

  try {
    const legacy = JSON.parse(legacyCookie);
    const userResponse = await fetch(`${SPMT_BASE_URL}/api/oauth/userinfo`, {
      headers: { Authorization: `Bearer ${spmtToken}` },
      cache: 'no-store',
    });
    const user = await userResponse.json().catch(() => null);
    const tenantId = String(user?.twitchId || user?.twitch_id || user?.id || '');
    if (!userResponse.ok || !tenantId || tenantId !== String(legacy?.id || '') || !user?.username) {
      console.warn('[Session Migration] Provider validation rejected legacy session', {
        status: userResponse.status,
        hasTenantId: Boolean(tenantId),
        tenantMatched: tenantId === String(legacy?.id || ''),
      });
      return NextResponse.redirect(loginUrl);
    }

    const response = NextResponse.redirect(new URL(safeNextPath(request.nextUrl.searchParams.get('next')), appOrigin));
    response.cookies.set('streamweaver-session', serializeSessionCookie({
      id: tenantId,
      spmtUserId: String(user.id),
      identityProvider: 'spmt',
      username: String(user.twitchUsername || user.twitch_username || user.username),
      displayName: String(user.displayName || user.display_name || user.username),
      loginTime: Number(legacy.loginTime || Date.now()),
    }), {
      httpOnly: true,
      secure: appOrigin.startsWith('https://'),
      sameSite: 'lax',
      path: '/',
      maxAge: STREAMWEAVER_SESSION_MAX_AGE,
    });
    console.info('[Session Migration] Legacy SPMT session upgraded', { tenantId });
    return response;
  } catch (error) {
    console.error('[Session Migration] Failed to upgrade legacy session', error);
    return NextResponse.redirect(loginUrl);
  }
}
