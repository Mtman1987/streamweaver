import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { getConfiguredAppUrl } from '@/lib/runtime-origin';
import { tenantPath, getTenantIdFromSession } from '@/lib/tenant';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const code = searchParams.get('code');
    const error = searchParams.get('error');

    if (error) {
      return NextResponse.redirect(new URL(`/integrations?error=kick_${error}`, request.url));
    }
    if (!code) {
      return NextResponse.redirect(new URL('/integrations?error=kick_no_code', request.url));
    }

    const clientId = process.env.KICK_CLIENT_ID;
    const clientSecret = process.env.KICK_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      return NextResponse.redirect(new URL('/integrations?error=kick_not_configured', request.url));
    }

    const tenantId = getTenantIdFromSession(request.cookies.get('streamweaver-session')?.value);
    if (!tenantId) {
      return NextResponse.redirect(new URL('/integrations?error=kick_no_session', request.url));
    }

    const baseUrl = getConfiguredAppUrl(request.nextUrl.origin);
    const redirectUri = `${baseUrl}/api/auth/kick/callback`;

    // Exchange code for tokens
    const tokenResponse = await fetch('https://id.kick.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
      }),
    });

    if (!tokenResponse.ok) {
      const errText = await tokenResponse.text();
      console.error('[Kick OAuth] Token exchange failed:', tokenResponse.status, errText);
      return NextResponse.redirect(new URL('/integrations?error=kick_token_failed', request.url));
    }

    const tokenData = await tokenResponse.json();
    const tokenExpiry = Date.now() + (tokenData.expires_in - 60) * 1000;

    // Get user info from Kick
    let kickUsername = '';
    let kickChannelId = '';
    let kickChatroomId = '';
    try {
      const userRes = await fetch('https://api.kick.com/public/v1/users/me', {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      });
      if (userRes.ok) {
        const userData = await userRes.json();
        kickUsername = userData.data?.username || userData.username || '';
        kickChannelId = String(userData.data?.channel_id || userData.channel_id || '');
        kickChatroomId = String(userData.data?.chatroom_id || userData.chatroom_id || '');
      }
    } catch (e) {
      console.error('[Kick OAuth] User info fetch failed:', e);
    }

    // Store tokens per-tenant
    const tokensFile = tenantPath(tenantId, 'tokens/kick-tokens.json');
    await fs.mkdir(path.dirname(tokensFile), { recursive: true });

    const kickTokens = {
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      tokenExpiry,
      username: kickUsername,
      channelId: kickChannelId,
      chatroomId: kickChatroomId,
      scopes: tokenData.scope || '',
      lastUpdated: new Date().toISOString(),
    };

    await fs.writeFile(tokensFile, JSON.stringify(kickTokens, null, 2));
    console.log(`[Kick OAuth] ✅ Tokens stored for tenant ${tenantId} (${kickUsername})`);

    return NextResponse.redirect(new URL('/integrations?kick=connected', request.url));
  } catch (error) {
    console.error('[Kick OAuth] Callback error:', error);
    return NextResponse.redirect(new URL('/integrations?error=kick_auth_failed', request.url));
  }
}
