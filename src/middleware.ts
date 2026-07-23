import { NextRequest, NextResponse } from 'next/server';

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

  // Test-only escape hatch: when explicitly enabled, skip the bearer-secret
  // check so the bridge can be exercised without provisioning the secret.
  // Still gated by the bridge header AND the path allowlist below. Defaults OFF.
  const authDisabled = String(process.env.MOUNTAINVIEW_BRIDGE_AUTH_DISABLED || '').trim() === 'true';
  if (!authDisabled) {
    const authHeader = request.headers.get('authorization') || '';
    if (!authHeader.startsWith('Bearer ')) return false;
    const token = authHeader.slice('Bearer '.length).trim();
    const expected = String(process.env.MOUNTAINVIEW_STREAMWEAVER_SECRET || '').trim();
    if (!expected || token !== expected) return false;
  }

  const pathname = request.nextUrl.pathname;
  return [
    '/api/ai/chat-with-memory',
    '/api/ai/image',
    '/api/private-chat/respond',
    '/api/tts',
    '/api/tts/current',
    '/api/tts/play',
    '/api/twitch/start',
    '/api/twitch/send-message',
    '/api/twitch/screen-assist/start',
    '/api/stream/stop',
    '/api/stream/overlay',
    '/api/glasses/audio-stream/start',
    '/api/glasses/video-stream/start',
    '/api/obs/scenes',
    '/api/memory/person-note',
  ].includes(pathname) || pathname.startsWith('/api/mountainview/');
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
  const signedCookieParts = sessionCookie?.split('.') || [];
  const hasSignedSessionCandidate = Boolean(
    signedCookieParts.length === 2 && signedCookieParts.every(Boolean),
  );

  // One-time, provider-verified migration for existing SPMT sessions. The old
  // unsigned tenant cookie alone is never accepted as proof. Migration is also
  // delegated to Node so the replacement cookie uses the runtime HMAC secret.
  if (!hasSignedSessionCandidate && request.method === 'GET' && sessionCookie?.startsWith('{')) {
    const spmtToken = request.cookies.get('streamweaver-spmt-token')?.value;
    if (spmtToken) {
      const migrateUrl = new URL('/api/session/migrate', request.url);
      migrateUrl.searchParams.set('next', `${request.nextUrl.pathname}${request.nextUrl.search}`);
      return NextResponse.redirect(migrateUrl);
    }
  }

  // Root path — redirect based on auth state (avoids rendering the broken root page)
  if (pathname === '/' || pathname === '') {
    if (hasSignedSessionCandidate) {
      return NextResponse.redirect(new URL('/dashboard', request.url));
    }
    return NextResponse.redirect(new URL('/login', request.url));
  }

  // Not authenticated
  if (!hasSignedSessionCandidate) {
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
