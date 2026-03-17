import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const clientId = process.env.NEXT_PUBLIC_TWITCH_CLIENT_ID;
  
  if (!clientId) {
    return NextResponse.json({
      error: 'Twitch client ID not configured'
    }, { status: 500 });
  }

  // Always use 127.0.0.1 for app functionality, localhost for OAuth callbacks
  const origin = 'http://127.0.0.1:3100';
  const redirectUri = 'http://localhost:3100/auth/twitch/callback';

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

  // Force Twitch to show the login prompt so users can switch accounts
  authUrl.searchParams.set('force_verify', 'true');

  console.log('[twitch-oauth] authUrl:', authUrl.toString());

  return NextResponse.redirect(authUrl.toString());
}
