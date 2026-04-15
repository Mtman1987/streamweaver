import { NextRequest, NextResponse } from 'next/server';
import { getOAuthRedirectUri } from '@/lib/runtime-origin';

export async function GET(request: NextRequest) {
  const clientId = process.env.NEXT_PUBLIC_TWITCH_CLIENT_ID;
  
  if (!clientId) {
    return NextResponse.json({
      error: 'Twitch client ID not configured'
    }, { status: 500 });
  }

  const redirectUri = getOAuthRedirectUri('twitch', request.nextUrl.origin);

  const roleParam = new URL(request.url).searchParams.get('role');
  const role = roleParam || 'login';

  console.log('[twitch-oauth] role:', role);
  const scope = role === 'login' ? [
    'user:read:email'
  ].join(' ') : [
    'chat:read',
    'chat:edit',
    'moderator:read:chatters',
    'channel:manage:broadcast',
    'moderator:manage:announcements',
    'channel:read:redemptions',
    'user:write:chat'
  ].join(' ');

  const authUrl = new URL('https://id.twitch.tv/oauth2/authorize');
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', scope);
  authUrl.searchParams.set('state', role);
  authUrl.searchParams.set('force_verify', 'true');

  console.log('[twitch-oauth] authUrl:', authUrl.toString());

  return NextResponse.redirect(authUrl.toString());
}