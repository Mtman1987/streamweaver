import { NextRequest, NextResponse } from 'next/server';
import { getConfiguredAppUrl } from '@/lib/runtime-origin';

export async function GET(request: NextRequest) {
  const clientId = process.env.KICK_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json({ error: 'Kick client ID not configured' }, { status: 500 });
  }

  const baseUrl = getConfiguredAppUrl(request.nextUrl.origin);
  const redirectUri = `${baseUrl}/api/auth/kick/callback`;

  const scopes = [
    'user:read',
    'channel:read',
    'channel:write',
    'chat:write',
    'events:subscribe',
    'moderation:manage',
  ].join(' ');

  const authUrl = new URL('https://id.kick.com/oauth/authorize');
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', scopes);
  authUrl.searchParams.set('state', 'kick-bot');

  return NextResponse.redirect(authUrl.toString());
}
