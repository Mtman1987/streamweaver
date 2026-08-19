import { NextRequest, NextResponse } from 'next/server';
import { applyRefreshedSpmtCookies, refreshSpmtConnection, type RefreshedSpmtConnection } from '@/lib/spmt-oauth';
import { parseSessionCookie } from '@/lib/session-cookie';

const SPMT_BASE_URL = String(process.env.SPMT_BASE_URL || 'https://spmt.live').replace(/\/$/, '');

const PUBLIC_PATHS = [
  '/login', '/auth/', '/api/auth/', '/api/__health', '/api/health', '/api/session',
  '/private-chat/control', '/api/private-chat/control',
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
  // This route performs its own service-auth check. Do not force a human SPMT
  // session in middleware before DiscordStreamHub's machine credential can be
  // evaluated by the route itself.
  '/api/internal/known-bots',
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

async function fetchSpmtIdentity(token: string) {
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

async function resolveSpmtIdentity(request: NextRequest): Promise<{ identity: any; refreshed: RefreshedSpmtConnection | null }> {
  const bearer = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || '';
  const token = request.cookies.get('streamweaver-spmt-token')?.value || bearer;
  let identity = await fetchSpmtIdentity(token);
  if (identity || bearer) return { identity, refreshed: null };

  const refreshed = await refreshSpmtConnection(request).catch(() => null);
  if (!refreshed) return { identity: null, refreshed: null };
  identity = await fetchSpmtIdentity(refreshed.accessToken);
  return { identity, refreshed: identity ? refreshed : null };
}

function withRefreshedCookies(response: NextResponse, refreshed: RefreshedSpmtConnection | null) {
  if (refreshed) applyRefreshedSpmtCookies(response, refreshed);
  return response;
}

function withCachedSessionHeaders(request: NextRequest) {
  const session = parseSessionCookie(request.cookies.get('streamweaver-session')?.value);
  if (!session) return null;
  const headers = new Headers(request.headers);
  headers.set('x-spmt-user-id', String(session.spmtUserId || session.id));
  headers.set('x-spmt-username', String(session.username || session.displayName || ''));
  // Cached sessions are display/workspace identity only. Administrator authority
  // is always revalidated against SPMT below on admin routes.
  headers.set('x-spmt-is-admin', '0');
  return { session, headers };
}

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const host = request.headers.get('host') || '';

  if ((host.startsWith('127.0.0.1') || host.startsWith('localhost')) && pathname.startsWith('/api/')) return NextResponse.next();
  if (MACHINE_PATHS.includes(pathname) || MACHINE_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return NextResponse.next();
  if (pathname.startsWith('/api/') && isPublicApiRequest(request)) return NextResponse.next();
  if (PUBLIC_PATHS.some((prefix) => pathname.startsWith(prefix))) return NextResponse.next();
  if (pathname.includes('.') && !pathname.endsWith('.html')) return NextResponse.next();

  const adminPath = ADMIN_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(prefix));
  const cached = withCachedSessionHeaders(request);

  // Render ordinary workspace pages from the already-signed local session without
  // waiting on a cross-service userinfo request. Protected APIs and all admin
  // routes continue through authoritative SPMT validation below, so this is a
  // stale-while-revalidate UI shell rather than an authorization bypass.
  if (cached && !pathname.startsWith('/api/') && !adminPath) {
    if (pathname === '/' || pathname === '') return NextResponse.redirect(new URL('/dashboard', request.url));
    return NextResponse.next({ request: { headers: cached.headers } });
  }

  const { identity, refreshed } = await resolveSpmtIdentity(request);
  if (!identity) {
    if (pathname.startsWith('/api/')) return NextResponse.json({ error: 'SPMT session required' }, { status: 401 });
    const login = new URL('/login', request.url);
    login.searchParams.set('next', `${pathname}${request.nextUrl.search}`);
    return NextResponse.redirect(login);
  }

  const admin = isAdmin(identity);
  if (adminPath && !admin) {
    if (pathname.startsWith('/api/')) return NextResponse.json({ error: 'SPMT admin required' }, { status: 403 });
    return withRefreshedCookies(NextResponse.redirect(new URL('/dashboard', request.url)), refreshed);
  }

  if (pathname === '/' || pathname === '') return withRefreshedCookies(NextResponse.redirect(new URL('/dashboard', request.url)), refreshed);

  const headers = new Headers(request.headers);
  headers.set('x-spmt-user-id', String(identity.id));
  headers.set('x-spmt-username', String(identity.username || identity.displayName || ''));
  headers.set('x-spmt-is-admin', admin ? '1' : '0');
  return withRefreshedCookies(NextResponse.next({ request: { headers } }), refreshed);
}

export const config = {
  runtime: 'nodejs',
  matcher: ['/((?!_next/static|_next/image|api/discord-media(?:/|$)).*)'],
};
