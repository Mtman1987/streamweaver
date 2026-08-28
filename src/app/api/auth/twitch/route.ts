import { NextRequest, NextResponse } from 'next/server';

import { getOAuthRedirectUri } from '@/lib/runtime-origin';
import { getTenantFromRequest } from '@/lib/tenant-context';
import { isAdmin } from '@/lib/tenant';
import {
  createPrivilegedTwitchOAuthTransaction,
  TWITCH_PRIVILEGED_OAUTH_COOKIE,
  TWITCH_PRIVILEGED_OAUTH_MAX_AGE,
  type PrivilegedTwitchOAuthRole,
} from '@/lib/twitch-privileged-oauth.server';

type TwitchOAuthRole = 'login' | 'broadcaster' | 'bot' | PrivilegedTwitchOAuthRole;

const TWITCH_OAUTH_ROLES = new Set<TwitchOAuthRole>([
  'login',
  'broadcaster',
  'bot',
  'community-bot',
  'the-count',
]);

function isPrivilegedRole(role: TwitchOAuthRole): role is PrivilegedTwitchOAuthRole {
  return role === 'community-bot' || role === 'the-count';
}

export async function GET(request: NextRequest) {
  const clientId = process.env.NEXT_PUBLIC_TWITCH_CLIENT_ID || process.env.TWITCH_CLIENT_ID;

  if (!clientId) {
    return NextResponse.json({
      error: 'Twitch client ID not configured',
    }, { status: 500 });
  }

  const requestedRole = String(new URL(request.url).searchParams.get('role') || 'login') as TwitchOAuthRole;
  if (!TWITCH_OAUTH_ROLES.has(requestedRole)) {
    return NextResponse.json({ error: 'Unsupported Twitch OAuth role' }, { status: 400 });
  }

  const session = getTenantFromRequest(request);
  if (isPrivilegedRole(requestedRole) && (!session?.tenantId || !isAdmin(session.tenantId))) {
    return NextResponse.json({ error: 'Owner authorization required' }, { status: 403 });
  }

  const redirectUri = getOAuthRedirectUri('twitch', request.nextUrl.origin);
  const countScopes = [
    'chat:read',
    'chat:edit',
    'user:read:chat',
    'user:write:chat',
    'user:bot',
  ];
  // Existing tenant grants remain broad because StreamWeaver uses their
  // broadcaster and moderation capabilities. The Count gets a least-privilege
  // grant dedicated only to receiving and sending chat.
  const standardScopes = [
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
    'channel:bot',
  ];
  const scope = (requestedRole === 'the-count' ? countScopes : standardScopes).join(' ');

  let state: string = requestedRole;
  let privilegedCookie: string | null = null;
  if (isPrivilegedRole(requestedRole)) {
    const transaction = createPrivilegedTwitchOAuthTransaction(requestedRole, session!.tenantId);
    state = transaction.state;
    privilegedCookie = transaction.cookieValue;
  }

  const authUrl = new URL('https://id.twitch.tv/oauth2/authorize');
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', scope);
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('force_verify', 'true');

  console.info('[twitch-oauth] Starting authorization', {
    role: requestedRole,
    privileged: isPrivilegedRole(requestedRole),
  });

  const response = NextResponse.redirect(authUrl.toString());
  if (privilegedCookie) {
    response.cookies.set(TWITCH_PRIVILEGED_OAUTH_COOKIE, privilegedCookie, {
      httpOnly: true,
      secure: request.nextUrl.protocol === 'https:',
      sameSite: 'lax',
      maxAge: TWITCH_PRIVILEGED_OAUTH_MAX_AGE,
      path: '/',
    });
  }
  return response;
}
