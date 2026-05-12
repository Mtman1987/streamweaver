import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { getConfiguredAppUrl } from '@/lib/runtime-origin';
import { tenantPath, getTenantIdFromSession, isAdmin, globalPath } from '@/lib/tenant';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const code = searchParams.get('code');
    const error = searchParams.get('error');
    const role = searchParams.get('state') || 'broadcaster';

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
    const tokenResponse = await fetch('https://api.kick.com/public/v1/oauth/token', {
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
        const d = userData.data || userData;
        kickUsername = d.username || d.slug || '';
        kickChannelId = String(d.channel_id || d.id || '');
        kickChatroomId = String(d.chatroom_id || d.chatroom?.id || '');
      }
    } catch (e) {
      console.error('[Kick OAuth] User info fetch failed:', e);
    }

    // Community bot — admin-only, global storage
    if (role === 'community-bot') {
      if (!isAdmin(tenantId)) {
        return NextResponse.redirect(new URL('/integrations?error=kick_admin_only', request.url));
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
      return NextResponse.redirect(new URL('/integrations?kick=community-bot-connected', request.url));
    }

    // Broadcaster or Bot — tenant-scoped
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

    return NextResponse.redirect(new URL(`/integrations?kick=${role}-connected`, request.url));
  } catch (error) {
    console.error('[Kick OAuth] Callback error:', error);
    return NextResponse.redirect(new URL('/integrations?error=kick_auth_failed', request.url));
  }
}
