import { NextRequest, NextResponse } from 'next/server';
import { getConfiguredAppUrl } from '@/lib/runtime-origin';
import { getTenantFromRequest } from '@/lib/tenant-context';
import { oauthState } from '@/services/streamelements';
export async function GET(request: NextRequest) {
  if (!getTenantFromRequest(request)) return NextResponse.redirect(`${getConfiguredAppUrl(request.nextUrl.origin)}/integrations?error=streamelements_session`);
  const clientId = process.env.STREAMELEMENTS_CLIENT_ID;
  if (!clientId) return NextResponse.redirect(`${getConfiguredAppUrl(request.nextUrl.origin)}/integrations?error=streamelements_not_configured`);
  const state = oauthState();
  const redirectUri = `${getConfiguredAppUrl(request.nextUrl.origin)}/api/auth/streamelements/callback`;
  const url = new URL('https://api.streamelements.com/oauth2/authorize');
  url.searchParams.set('client_id', clientId); url.searchParams.set('redirect_uri', process.env.STREAMELEMENTS_REDIRECT_URI || redirectUri); url.searchParams.set('response_type', 'code'); url.searchParams.set('scope', 'channel:read loyalty:read bot:read'); url.searchParams.set('state', state);
  const response = NextResponse.redirect(url.toString());
  response.cookies.set('streamelements_oauth_state', state, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', maxAge: 600, path: '/api/auth/streamelements' });
  return response;
}
