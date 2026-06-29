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

function getSession(request: NextRequest): { id: string; username: string } | null {
  const cookie = request.cookies.get('streamweaver-session')?.value;
  if (!cookie) return null;
  try {
    const parsed = JSON.parse(cookie);
    return parsed.id ? parsed : null;
  } catch {
    return null;
  }
}

function isPublicApiRequest(request: NextRequest): boolean {
  const { pathname, searchParams } = request.nextUrl;
  const method = request.method.toUpperCase();
  const hasTenant = Boolean(searchParams.get('tenant'));

  if (pathname.startsWith('/api/auth/')) return true;
  if (pathname === '/api/__health' || pathname === '/api/health' || pathname === '/api/session') return true;
  if (pathname === '/api/discord/chat') return true;
  if (pathname.startsWith('/api/gen-settings')) return true;
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
  return [
    '/api/ai/chat-with-memory',
    '/api/ai/image',
    '/api/private-chat/respond',
    '/api/tts',
    '/api/tts/current',
  ].includes(request.nextUrl.pathname);
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow internal server-to-server API requests (localhost)
  const host = request.headers.get('host') || '';
  if ((host.startsWith('127.0.0.1') || host.startsWith('localhost')) && pathname.startsWith('/api/')) {
    return NextResponse.next();
  }

  if (pathname === '/api/ai/shoutout' && hasSharedBotAccess(request)) {
    return NextResponse.next();
  }

  if (pathname.startsWith('/api/mountainview/')) {
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

  const session = getSession(request);

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
