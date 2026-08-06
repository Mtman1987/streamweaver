import { NextRequest, NextResponse } from 'next/server';

const SPMT_BASE_URL = String(process.env.SPMT_BASE_URL || 'https://spmt.live').replace(/\/$/, '');

const PUBLIC_PATHS = [
  '/login', '/auth/', '/api/auth/', '/api/__health', '/api/health', '/api/session',
  '/overlay/', '/xpn/', '/tts-listener', '/tts-player', '/say-player', '/tts-mixer',
  '/brb-player', '/shoutout-player', '/partner-checkin', '/pokemon-pack-overlay',
  '/pokemon-collection-overlay', '/pokemon-trade-overlay', '/gym-battle-overlay',
  '/gamble-overlay', '/classic-gamble-overlay', '/pokemon-test', '/test-cardback',
  '/test-collection', '/_next/', '/favicon.ico', '/app-icon.png', '/StreamWeaver.png',
  '/manifest.json',
];

const MACHINE_PATHS = [
  '/api/discord/chat', '/api/integrations/social-stream', '/api/ai/shoutout',
  '/api/kick/chat-tag-broadcast', '/api/quackverse/pack-overlay',
  '/api/shared-chat/spmt-feed', '/api/shared-chat/spmt-dispatch', '/api/shared-chat/spmt-operator',
];

const MACHINE_PREFIXES = ['/api/discord-avatar/', '/api/discord-media/', '/api/say/', '/api/webhooks/'];
const ADMIN_PREFIXES = ['/admin', '/api/admin/', '/settings/admin', '/api/settings/admin'];

function isPublicApiRequest(request: NextRequest): boolean {
  const { pathname, searchParams } = request.nextUrl;
  const method = request.method.toUpperCase();
  if (pathname.startsWith('/api/auth/') || pathname === '/api/__health' || pathname === '/api/health' || pathname === '/api/session') return true;
  if (method !== 'GET') return false;
  if (pathname.startsWith('/api/ai/image/file/')) return true;
  if (pathname === '/api/ai/image/library' && searchParams.get('scope') !== 'private') return true;
  if (pathname.startsWith('/api/overlay/')) return true;
  if (['/api/gamble/overlay-data','/api/classic-gamble/overlay-data','/api/avatars','/api/bic-list','/api/bic-counter','/api/pokedex','/api/tts/current'].includes(pathname)) return true;
  if (pathname === '/api/shared-chat/featured' && searchParams.get('tenant')) return true;
  if (pathname === '/api/user-profile' && searchParams.get('tenant')) return true;
  if (pathname === '/api/pokemon/gym' && searchParams.get('tenant')) return true;
  if (pathname === '/api/points' && searchParams.get('tenant') && searchParams.get('action') === 'leaderboard') return true;
  return false;
}

function isAdmin(identity: any): boolean {
  if (identity?.isAdmin === true || identity?.is_admin === true || identity?.is_admin === 1) return true;
  const role = String(identity?.role || '').toLowerCase();
  const roles = Array.isArray(identity?.roles) ? identity.roles.map((value: unknown) => String(value).toLowerCase()) : [];
  return role === 'admin' || role === 'owner' || roles.includes('admin') || roles.includes('owner');
}

async function resolveSpmtIdentity(request: NextRequest) {
  const token = request.cookies.get('streamweaver-spmt-token')?.value || request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || '';
  if (!token) return null;
  const response = await fetch(`${SPMT_BASE_URL}/api/oauth/userinfo`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    cache: 'no-store',
  }).catch(() => null);
  if (!response?.ok) return null;
  const payload = await response.json().catch(() => null);
  const identity = payload?.user || payload?.profile || payload;
  return identity?.id ? identity : null;
}

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const host = request.headers.get('host') || '';

  if ((host.startsWith('127.0.0.1') || host.startsWith('localhost')) && pathname.startsWith('/api/')) return NextResponse.next();
  if (MACHINE_PATHS.includes(pathname) || MACHINE_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return NextResponse.next();
  if (pathname.startsWith('/api/') && isPublicApiRequest(request)) return NextResponse.next();
  if (PUBLIC_PATHS.some((prefix) => pathname.startsWith(prefix))) return NextResponse.next();
  if (pathname.includes('.') && !pathname.endsWith('.html')) return NextResponse.next();

  const identity = await resolveSpmtIdentity(request);
  if (!identity) {
    if (pathname.startsWith('/api/')) return NextResponse.json({ error: 'SPMT session required' }, { status: 401 });
    const login = new URL('/login', request.url);
    login.searchParams.set('next', `${pathname}${request.nextUrl.search}`);
    return NextResponse.redirect(login);
  }

  const admin = isAdmin(identity);
  if (ADMIN_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(prefix)) && !admin) {
    if (pathname.startsWith('/api/')) return NextResponse.json({ error: 'SPMT admin required' }, { status: 403 });
    return NextResponse.redirect(new URL('/dashboard', request.url));
  }

  if (pathname === '/' || pathname === '') return NextResponse.redirect(new URL('/dashboard', request.url));

  const headers = new Headers(request.headers);
  headers.set('x-spmt-user-id', String(identity.id));
  headers.set('x-spmt-username', String(identity.username || identity.displayName || ''));
  headers.set('x-spmt-is-admin', admin ? '1' : '0');
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|api/discord-media(?:/|$)).*)'],
};
