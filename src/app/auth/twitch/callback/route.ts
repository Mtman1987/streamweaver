import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { getConfiguredAppUrl, getOAuthRedirectUri } from '@/lib/runtime-origin';
import { tenantPath, bootstrapTenant, communityBotTokensPath, isAdmin } from '@/lib/tenant';
import { parseSessionCookie, serializeSessionCookie, STREAMWEAVER_SESSION_MAX_AGE } from '@/lib/session-cookie';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get('code');
  const error = searchParams.get('error');
  const errorDescription = searchParams.get('error_description');
  const requestedState = searchParams.get('state') || 'login';

  console.info('[Twitch OAuth] Callback received', {
    state: requestedState,
    hasCode: Boolean(code),
    providerError: error || null,
  });

  if (error) {
    return NextResponse.json({ error, error_description: errorDescription }, { status: 400 });
  }

  if (!code) {
    return NextResponse.json({ error: 'No authorization code provided' }, { status: 400 });
  }

  try {
    const appOrigin = getConfiguredAppUrl(request.nextUrl.origin);
    const redirectUri = getOAuthRedirectUri('twitch', request.nextUrl.origin);
    const clientId = process.env.TWITCH_CLIENT_ID;
    const clientSecret = process.env.TWITCH_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      return NextResponse.json({ error: 'Twitch client credentials not configured' }, { status: 500 });
    }

    // Exchange code for token
    const tokenResponse = await fetch('https://id.twitch.tv/oauth2/token', {
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
      const errorData = await tokenResponse.text();
      console.error('[Twitch OAuth] Token exchange failed', { status: tokenResponse.status, details: errorData });
      return NextResponse.json({ error: 'Failed to exchange code for token', details: errorData }, { status: 500 });
    }

    const tokenData = await tokenResponse.json();
    const tokenExpiry = Date.now() + (tokenData.expires_in - 60) * 1000;

    // Fetch user info from Twitch
    const userResponse = await fetch('https://api.twitch.tv/helix/users', {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        'Client-Id': clientId,
      },
    });

    let userInfo: any = null;
    if (userResponse.ok) {
      const userData = await userResponse.json();
      userInfo = userData.data[0];
    }
    if (!userInfo) {
      console.error('[Twitch OAuth] User profile lookup failed', { status: userResponse.status });
    }

    const state = requestedState;

    // ─── LOGIN FLOW ───
    // Creates/validates the tenant and sets the session cookie.
    if (state === 'login' && userInfo) {
      const twitchId = userInfo.id;
      const username = userInfo.login;

      // Bootstrap tenant directory on first login
      await bootstrapTenant(twitchId, username);

      // Store login token in tenant folder
      const tokensFile = tenantPath(twitchId, 'tokens/twitch-tokens.json');
      let existingTokens: Record<string, any> = {};
      try {
        existingTokens = JSON.parse(await fs.readFile(tokensFile, 'utf-8'));
      } catch {}

      const tokenStorage = {
        ...existingTokens,
        loginToken: tokenData.access_token,
        loginRefreshToken: tokenData.refresh_token,
        loginTokenExpiry: tokenExpiry,
        loginUsername: username,
        loginProfileImageUrl: userInfo.profile_image_url,
        loginAvatarUrl: userInfo.profile_image_url,
        // Also store as broadcaster token — the login user IS the broadcaster
        // for their own tenant. This prevents a second OAuth grant from
        // invalidating the login refresh token.
        broadcasterToken: tokenData.access_token,
        broadcasterRefreshToken: tokenData.refresh_token,
        broadcasterTokenExpiry: tokenExpiry,
        broadcasterUsername: username,
        broadcasterProfileImageUrl: userInfo.profile_image_url,
        broadcasterAvatarUrl: userInfo.profile_image_url,
        lastUpdated: new Date().toISOString(),
      };
      await fs.writeFile(tokensFile, JSON.stringify(tokenStorage, null, 2));

      // Set session cookie
      const sessionData = {
        id: twitchId,
        username,
        displayName: userInfo.display_name,
        avatar: userInfo.profile_image_url,
        loginTime: Date.now(),
      };

      const response = NextResponse.redirect(`${appOrigin}/dashboard`);
      response.cookies.set('streamweaver-session', serializeSessionCookie(sessionData), {
        httpOnly: true,
        secure: appOrigin.startsWith('https://'),
        sameSite: 'lax',
        maxAge: STREAMWEAVER_SESSION_MAX_AGE,
      });
      console.info('[Twitch OAuth] Login session issued', { tenantId: twitchId, username });
      return response;
    }

    // ─── BROADCASTER / BOT / COMMUNITY-BOT FLOW ───
    // Requires an existing session so we know which tenant to write to.
    const sessionCookie = request.cookies.get('streamweaver-session')?.value;
    const tenantId = parseSessionCookie(sessionCookie)?.id || null;

    if (!tenantId) {
      // No session — if this is a broadcaster re-auth, treat it like a login
      // so the fresh token isn't thrown away.
      if (state === 'broadcaster' && userInfo) {
        const twitchId = userInfo.id;
        const username = userInfo.login;
        await bootstrapTenant(twitchId, username);

        const tokensFile = tenantPath(twitchId, 'tokens/twitch-tokens.json');
        let existingTokens: Record<string, any> = {};
        try { existingTokens = JSON.parse(await fs.readFile(tokensFile, 'utf-8')); } catch {}

        const tokenStorage = {
          ...existingTokens,
          loginToken: tokenData.access_token,
          loginRefreshToken: tokenData.refresh_token,
          loginTokenExpiry: tokenExpiry,
          loginUsername: username,
          loginProfileImageUrl: userInfo.profile_image_url,
          loginAvatarUrl: userInfo.profile_image_url,
          broadcasterToken: tokenData.access_token,
          broadcasterRefreshToken: tokenData.refresh_token,
          broadcasterTokenExpiry: tokenExpiry,
          broadcasterUsername: username,
          broadcasterProfileImageUrl: userInfo.profile_image_url,
          broadcasterAvatarUrl: userInfo.profile_image_url,
          lastUpdated: new Date().toISOString(),
        };
        await fs.writeFile(tokensFile, JSON.stringify(tokenStorage, null, 2));

        const sessionData = {
          id: twitchId,
          username,
          displayName: userInfo.display_name,
          avatar: userInfo.profile_image_url,
          loginTime: Date.now(),
        };
        const response = NextResponse.redirect(`${appOrigin}/integrations?success=true`);
        response.cookies.set('streamweaver-session', serializeSessionCookie(sessionData), {
          httpOnly: true,
          secure: appOrigin.startsWith('https://'),
          sameSite: 'lax',
          maxAge: STREAMWEAVER_SESSION_MAX_AGE,
        });
        return response;
      }
      return NextResponse.redirect(`${appOrigin}/login?error=session_required`);
    }

    const isBroadcaster = state === 'broadcaster';
    const isBot = state === 'bot';
    const isCommunityBot = state === 'community-bot';

    // Community bot is admin-only and stored globally
    if (isCommunityBot) {
      if (!isAdmin(tenantId)) {
        return NextResponse.redirect(`${appOrigin}/integrations?error=admin_only`);
      }

      const cbPath = communityBotTokensPath();
      await fs.mkdir(path.dirname(cbPath), { recursive: true });

      let existing: Record<string, any> = {};
      try { existing = JSON.parse(await fs.readFile(cbPath, 'utf-8')); } catch {}

      const username = userInfo?.login || '';
      const storage = {
        ...existing,
        communityBotToken: tokenData.access_token,
        communityBotRefreshToken: tokenData.refresh_token,
        communityBotTokenExpiry: tokenExpiry,
        communityBotUsername: username,
        lastUpdated: new Date().toISOString(),
      };
      await fs.writeFile(cbPath, JSON.stringify(storage, null, 2));
      return NextResponse.redirect(`${appOrigin}/integrations?success=true`);
    }

    // Broadcaster or Bot — store in tenant folder
    const tokensFile = tenantPath(tenantId, 'tokens/twitch-tokens.json');
    let existingTokens: Record<string, any> = {};
    try {
      existingTokens = JSON.parse(await fs.readFile(tokensFile, 'utf-8'));
    } catch {}

    // Validate to get username
    const validateResponse = await fetch('https://id.twitch.tv/oauth2/validate', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    let username = userInfo?.login || '';
    if (validateResponse.ok) {
      const validateData = await validateResponse.json();
      username = validateData.login || username;
    }

    if (isBroadcaster && userInfo?.id && String(userInfo.id) !== String(tenantId)) {
      return NextResponse.redirect(
        `${appOrigin}/integrations?error=wrong_broadcaster&msg=Broadcaster+auth+must+use+the+Twitch+account+that+is+logged+into+this+StreamWeaver+tenant.`
      );
    }

    // Prevent connecting the same Twitch account for both Broadcaster and Bot
    if (isBot && existingTokens.broadcasterUsername && existingTokens.broadcasterUsername.toLowerCase() === username.toLowerCase()) {
      return NextResponse.redirect(`${appOrigin}/integrations?error=same_account&msg=Bot+must+be+a+different+Twitch+account+than+your+Broadcaster.+Log+into+your+bot+account+on+Twitch+first.`);
    }
    if (isBroadcaster && existingTokens.botUsername && existingTokens.botUsername.toLowerCase() === username.toLowerCase()) {
      return NextResponse.redirect(`${appOrigin}/integrations?error=same_account&msg=Broadcaster+must+be+a+different+Twitch+account+than+your+Bot.`);
    }

    const tokenStorage = {
      ...existingTokens,
      ...(isBroadcaster
        ? {
            broadcasterToken: tokenData.access_token,
            broadcasterRefreshToken: tokenData.refresh_token,
            broadcasterTokenExpiry: tokenExpiry,
            broadcasterUsername: username,
            broadcasterProfileImageUrl: userInfo?.profile_image_url,
            broadcasterAvatarUrl: userInfo?.profile_image_url,
            // Keep login token in sync to prevent stale refresh tokens
            loginToken: tokenData.access_token,
            loginRefreshToken: tokenData.refresh_token,
            loginTokenExpiry: tokenExpiry,
            loginProfileImageUrl: userInfo?.profile_image_url,
            loginAvatarUrl: userInfo?.profile_image_url,
          }
        : isBot
          ? {
              botToken: tokenData.access_token,
              botRefreshToken: tokenData.refresh_token,
              botTokenExpiry: tokenExpiry,
              botUsername: username,
              botProfileImageUrl: userInfo?.profile_image_url,
              botAvatarUrl: userInfo?.profile_image_url,
            }
          : {}),
      lastUpdated: new Date().toISOString(),
    };

    await fs.writeFile(tokensFile, JSON.stringify(tokenStorage, null, 2));

    // Reconnect Twitch IRC via the custom HTTP server (same process as the IRC client map)
    try {
      console.log(`[OAuth] Triggering IRC reconnect for tenant ${tenantId}...`);
      const wsPort = process.env.WS_PORT || '8090';
      const res = await fetch(`http://127.0.0.1:${wsPort}/api/twitch/reconnect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId }),
      });
      console.log(`[OAuth] IRC reconnect response: ${res.status}`);
    } catch (e) {
      console.warn('[OAuth] Twitch IRC reconnect failed:', e);
    }

    return NextResponse.redirect(`${appOrigin}/integrations?success=true`);
  } catch (error) {
    console.error('OAuth callback error:', error);
    return NextResponse.json({ error: 'Internal server error during token exchange' }, { status: 500 });
  }
}
