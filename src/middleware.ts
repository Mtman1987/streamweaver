import { NextRequest, NextResponse } from 'next/server';
import { serializeSessionCookieEdge, STREAMWEAVER_EDGE_SESSION_MAX_AGE, verifySessionCookieEdge } from '@/lib/session-cookie-edge';

const PUBLIC_PATHS = [
  '/login',
  '/auth/',
  '/api/auth/',
  '/api/__health',
  '/api/health',
  '/api/session',
  '/overlay/',
  '/xpn/',
  '/tts-listener',
  '/tts-player',
  '/say-player',
  '/tts-mixer',
  '/brb-player',
  '/shoutout-player',
  '/partner-checkin',
  '/pokemon-pack-overlay',
  '/pokemon-collection-overlay',
  '/pokemon-trade-overlay',
  '/gym-battle-overlay',
  '/gamble-overlay',
  '/classic-gamble-overlay',
  '/pokemon-test',
  '/test-cardback',
  '/test-collection',
  '/_next/',
  '/favicon.ico',
  '/app-icon.png',
  '/StreamWeaver.png',
  '/manifest.json',
];

function isPublicApiRequest(request: NextRequest): boolean {
  const { pathname, searchParams } = request.nextUrl;
  const method = request.method.toUpperCase();
  const hasTenant = Boolean(searchParams.get('tenant'));

  if (pathname.startsWith('/api/auth/')) return true;
  if (pathname === '/api/__health' || pathname === '/api/health' || pathname === '/api/session') return true;
  if (pathname === '/api/discord/chat') return true;
  if (pathname.startsWith('/api/discord-media/')) return true;
  if (pathname === '/api/integrations/social-stream') return true;
  if (pathname.startsWith('/api/say/')) return true;

  if (method !== 'GET') return false;

  if (pathname.startsWith('/api/ai/image/file/')) return true;
  if (pathname === '/api/ai/image/library' && searchParams.get('scope') !== 'private') return true;
  if (pathname.startsWith('/api/overlay/')) return true;
  if (pathname === '/api/gamble/overlay-data') return true;
  if (pathname === '/api/classic-gamble/overlay-data') return true;
  if (pathname === '/api/avatars') return true;
  if (pathname === '/api/bic-list') return true;
  if (pathname === '/api/bic-counter') return true;
  if (pathname === '/api/pokedex') return true;
  if (pathname === '/api/tts/current') return true;
  if (pathname === '/api/user-profile' && hasTenant) return true;
  if (pathname === '/api/pokemon/gym' && hasTenant) return true;
  if (
    pathname === '/api/points' &&
    hasTenant &&
    searchParams.get('action') === 'leaderboard'
  ) {
    return true;
  }

  return false;
}

function hasSharedBotAccess(request: NextRequest): boolean {
  const authHeader = request.headers.get('authorization') || '';
  if (!authHeader.startsWith('Bearer ')) return false;
  const token = authHeader.slice('Bearer '.length).trim();
  const sharedSecret = String(process.env.BOT_SECRET_KEY || '').trim();
  return Boolean(sharedSecret && token && token === sharedSecret);
}

function hasMountainViewBridgeAccess(request: NextRequest): boolean {
  if (request.headers.get('x-mountainview-bridge') !== '1') return false;
  const authHeader = request.headers.get('authorization') || '';
  if (!authHeader.startsWith('Bearer ')) return false;
  const token = authHeader.slice('Bearer '.length).trim();
  const expected = String(process.env.MOUNTAINVIEW_STREAMWEAVER_SECRET || '').trim();
  if (!expected || token !== expected) return false;
  return [
    '/api/ai/chat-with-memory',
    '/api/ai/image',
    '/api/private-chat/respond',
    '/api/tts',
    '/api/tts/current',
  ].includes(request.nextUrl.pathname);
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow internal server-to-server API requests (localhost)
  const host = request.headers.get('host') || '';
  if ((host.startsWith('127.0.0.1') || host.startsWith('localhost')) && pathname.startsWith('/api/')) {
    return NextResponse.next();
  }

  if ((pathname === '/api/ai/shoutout' || pathname === '/api/kick/chat-tag-broadcast') && hasSharedBotAccess(request)) {
    return NextResponse.next();
  }

  if ([
    '/api/ai/chat-with-memory',
    '/api/ai/image',
    '/api/private-chat/respond',
    '/api/tts',
    '/api/tts/current',
  ].includes(pathname) && hasSharedBotAccess(request)) {
    return NextResponse.next();
  }

  if (hasMountainViewBridgeAccess(request)) {
    return NextResponse.next();
  }

  if (pathname.startsWith('/api/') && isPublicApiRequest(request)) {
    return NextResponse.next();
  }

  // Allow public paths
  if (PUBLIC_PATHS.some(p => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // Allow static assets
  if (pathname.includes('.') && !pathname.endsWith('.html')) {
    return NextResponse.next();
  }

  const sessionCookie = request.cookies.get('streamweaver-session')?.value;
  const session = await verifySessionCookieEdge(sessionCookie);

  // One-time, provider-verified migration for existing SPMT sessions. The old
  // unsigned tenant cookie alone is never accepted as proof.
  if (!session && request.method === 'GET' && sessionCookie?.startsWith('{')) {
    const spmtToken = request.cookies.get('streamweaver-spmt-token')?.value;
    if (spmtToken) {
      try {
        const legacy = JSON.parse(sessionCookie);
        const spmtBaseUrl = String(process.env.SPMT_BASE_URL || 'https://spmt.live').replace(/\/$/, '');
        const userResponse = await fetch(`${spmtBaseUrl}/api/oauth/userinfo`, {
          headers: { Authorization: `Bearer ${spmtToken}` },
          cache: 'no-store',
        });
        const user = await userResponse.json().catch(() => null);
        const tenantId = String(user?.twitchId || user?.twitch_id || user?.id || '');
        if (userResponse.ok && tenantId && tenantId === String(legacy?.id || '') && user?.username) {
          const signed = await serializeSessionCookieEdge({
            id: tenantId,
            spmtUserId: String(user.id),
            identityProvider: 'spmt',
            username: String(user.twitchUsername || user.twitch_username || user.username),
            displayName: String(user.displayName || user.display_name || user.username),
            loginTime: Number(legacy.loginTime || Date.now()),
          });
          const redirect = NextResponse.redirect(request.nextUrl);
          redirect.cookies.set('streamweaver-session', signed, {
            httpOnly: true,
            secure: request.nextUrl.protocol === 'https:',
            sameSite: 'lax',
            path: '/',
            maxAge: STREAMWEAVER_EDGE_SESSION_MAX_AGE,
          });
          return redirect;
        }
      } catch {}
    }
  }

  // Root path — redirect based on auth state (avoids rendering the broken root page)
  if (pathname === '/' || pathname === '') {
    if (session) {
      return NextResponse.redirect(new URL('/dashboard', request.url));
    }
    return NextResponse.redirect(new URL('/login', request.url));
  }

  // Not authenticated
  if (!session) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }
    return NextResponse.redirect(new URL('/login', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image).*)'],
};
