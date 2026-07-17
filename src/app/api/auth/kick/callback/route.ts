import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { getConfiguredAppUrl } from '@/lib/runtime-origin';
import { tenantPath, getTenantIdFromSession, isAdmin, globalPath } from '@/lib/tenant';

export async function GET(request: NextRequest) {
  const appOrigin = getConfiguredAppUrl(request.nextUrl.origin);

  try {
    const searchParams = request.nextUrl.searchParams;
    const code = searchParams.get('code');
    const error = searchParams.get('error');
    const state = searchParams.get('state') || 'broadcaster';
    const role = state.split('_')[0] || 'broadcaster';

    if (error) {
      return NextResponse.redirect(`${appOrigin}/integrations?error=kick_${error}`);
    }
    if (!code) {
      return NextResponse.redirect(`${appOrigin}/integrations?error=kick_no_code`);
    }

    const clientId = process.env.KICK_CLIENT_ID;
    const clientSecret = process.env.KICK_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      return NextResponse.redirect(`${appOrigin}/integrations?error=kick_not_configured`);
    }

    const codeVerifier = request.cookies.get('kick_pkce_verifier')?.value;
    if (!codeVerifier) {
      console.error('[Kick OAuth] No PKCE verifier cookie found');
      return NextResponse.redirect(`${appOrigin}/integrations?error=kick_pkce_missing`);
    }

    const tenantId = getTenantIdFromSession(request.cookies.get('streamweaver-session')?.value);
    if (!tenantId) {
      return NextResponse.redirect(`${appOrigin}/integrations?error=kick_no_session`);
    }

    const redirectUri = `${appOrigin}/api/auth/kick/callback`;

    const tokenResponse = await fetch('https://id.kick.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
        code_verifier: codeVerifier,
      }),
    });

    if (!tokenResponse.ok) {
      const errText = await tokenResponse.text();
      console.error('[Kick OAuth] Token exchange failed:', tokenResponse.status, errText);
      return NextResponse.redirect(`${appOrigin}/integrations?error=kick_token_failed`);
    }

    const tokenData = await tokenResponse.json();
    const tokenExpiry = Date.now() + ((tokenData.expires_in || 3600) - 60) * 1000;

    let kickUsername = '';
    let kickChannelId = '';
    let kickChatroomId = '';
    try {
      const userRes = await fetch('https://api.kick.com/public/v1/users', {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      });
      if (userRes.ok) {
        const userData = await userRes.json();
        const user = Array.isArray(userData.data) ? userData.data[0] : userData.data || userData;
        kickUsername = user?.name || user?.username || user?.slug || '';
        kickChannelId = String(user?.user_id || user?.channel_id || user?.id || '');
        // Kick's public chat Pusher channel is keyed by broadcaster_user_id.
        kickChatroomId = String(user?.chatroom_id || user?.chatroom?.id || kickChannelId);
      }
    } catch (e) {
      console.error('[Kick OAuth] User info fetch failed:', e);
    }

    if (role === 'community-bot') {
      if (!isAdmin(tenantId)) {
        return NextResponse.redirect(`${appOrigin}/integrations?error=kick_admin_only`);
      }
      const globalFile = globalPath('kick-bot-tokens.json');
      await fs.mkdir(path.dirname(globalFile), { recursive: true });
      await fs.writeFile(globalFile, JSON.stringify({
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token,
        tokenExpiry,
        username: kickUsername,
        channelId: kickChannelId,
        chatroomId: kickChatroomId,
        lastUpdated: new Date().toISOString(),
      }, null, 2));
      console.log(`[Kick OAuth] ✅ Community bot token stored (${kickUsername})`);
      const resp = NextResponse.redirect(`${appOrigin}/integrations?kick=community-bot-connected`);
      resp.cookies.delete('kick_pkce_verifier');
      resp.cookies.delete('kick_oauth_state');
      return resp;
    }

    const tokensFile = tenantPath(tenantId, 'tokens/kick-tokens.json');
    await fs.mkdir(path.dirname(tokensFile), { recursive: true });

    let existing: Record<string, any> = {};
    try { existing = JSON.parse(await fs.readFile(tokensFile, 'utf-8')); } catch {}

    const isBroadcaster = role === 'broadcaster';
    const tokenStorage = {
      ...existing,
      ...(isBroadcaster ? {
        broadcasterToken: tokenData.access_token,
        broadcasterRefreshToken: tokenData.refresh_token,
        broadcasterTokenExpiry: tokenExpiry,
        broadcasterUsername: kickUsername,
        broadcasterChannelId: kickChannelId,
        broadcasterChatroomId: kickChatroomId,
      } : {
        botToken: tokenData.access_token,
        botRefreshToken: tokenData.refresh_token,
        botTokenExpiry: tokenExpiry,
        botUsername: kickUsername,
        botChannelId: kickChannelId,
        botChatroomId: kickChatroomId,
      }),
      lastUpdated: new Date().toISOString(),
    };

    await fs.writeFile(tokensFile, JSON.stringify(tokenStorage, null, 2));
    console.log(`[Kick OAuth] ✅ ${role} token stored for tenant ${tenantId} (${kickUsername})`);

    const resp = NextResponse.redirect(`${appOrigin}/integrations?kick=${role}-connected`);
    resp.cookies.delete('kick_pkce_verifier');
    resp.cookies.delete('kick_oauth_state');
    return resp;
  } catch (error) {
    console.error('[Kick OAuth] Callback error:', error);
    return NextResponse.redirect(`${appOrigin}/integrations?error=kick_auth_failed`);
  }
}
