import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { getConfiguredAppUrl } from '@/lib/runtime-origin';

// Store PKCE verifiers temporarily (in production, use a session/cookie)
const pkceStore = new Map<string, string>();

function getPkceVerifier(state: string): string | undefined {
  const v = pkceStore.get(state);
  if (v) pkceStore.delete(state);
  return v;
}

export async function GET(request: NextRequest) {
  const clientId = process.env.KICK_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json({ error: 'Kick client ID not configured' }, { status: 500 });
  }

  const baseUrl = getConfiguredAppUrl(request.nextUrl.origin);
  const redirectUri = `${baseUrl}/api/auth/kick/callback`;

  const role = request.nextUrl.searchParams.get('role') || 'broadcaster';

  const scopes = [
    'user:read',
    'channel:read',
    'channel:write',
    'chat:write',
    'events:subscribe',
    'moderation:manage',
  ].join(' ');

  // Generate PKCE
  const codeVerifier = crypto.randomBytes(32).toString('base64url');
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');

  // Store verifier keyed by state (role) for retrieval in callback
  const state = `${role}_${crypto.randomBytes(8).toString('hex')}`;
  pkceStore.set(state, codeVerifier);

  // Also store in a cookie so it survives the redirect
  const authUrl = new URL('https://id.kick.com/oauth/authorize');
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', scopes);
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('code_challenge', codeChallenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');

  const response = NextResponse.redirect(authUrl.toString());
  // Store code_verifier in a cookie for the callback to use
  response.cookies.set('kick_pkce_verifier', codeVerifier, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 600, // 10 minutes
    path: '/api/auth/kick',
  });
  response.cookies.set('kick_oauth_state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 600,
    path: '/api/auth/kick',
  });

  return response;
}
