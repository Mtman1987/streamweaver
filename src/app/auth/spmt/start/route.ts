import { randomBytes } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getConfiguredAppUrl } from '@/lib/runtime-origin';

const SPMT_BASE_URL = String(process.env.SPMT_BASE_URL || 'https://spmt.live').replace(/\/$/, '');

export async function GET(request: NextRequest) {
  const appOrigin = getConfiguredAppUrl(request.nextUrl.origin);
  const state = randomBytes(24).toString('base64url');
  const requestedNext = String(request.nextUrl.searchParams.get('next') || '/dashboard');
  const nextPath = requestedNext.startsWith('/') && !requestedNext.startsWith('//')
    ? requestedNext
    : '/dashboard';
  const redirectUri = `${appOrigin}/auth/spmt/callback`;
  const authorizeUrl = new URL('/api/oauth/authorize', SPMT_BASE_URL);
  authorizeUrl.searchParams.set('client_id', 'streamweaver');
  authorizeUrl.searchParams.set('redirect_uri', redirectUri);
  authorizeUrl.searchParams.set('state', state);

  const response = NextResponse.redirect(authorizeUrl);
  response.cookies.set('streamweaver-spmt-state', state, {
    httpOnly: true,
    secure: appOrigin.startsWith('https://'),
    sameSite: 'lax',
    path: '/',
    maxAge: 10 * 60,
  });
  response.cookies.set('streamweaver-spmt-next', nextPath, {
    httpOnly: true,
    secure: appOrigin.startsWith('https://'),
    sameSite: 'lax',
    path: '/',
    maxAge: 10 * 60,
  });
  return response;
}
