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
  // Always request full scopes — Twitch invalidates previous refresh tokens
  // when the same user re-authorizes the same app, so we can't have separate
  // login vs broadcaster grants without them killing each other.
  const scope = [
    'user:read:email',
    'chat:read',
    'chat:edit',
    'moderator:read:chatters',
    'moderation:read',
    'channel:manage:broadcast',
    'clips:edit',
    'moderator:manage:announcements',
    'channel:read:redemptions',
    'user:write:chat',
    'user:bot',
    'channel:bot'
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
