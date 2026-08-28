import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { getConfiguredAppUrl, getOAuthRedirectUri } from '@/lib/runtime-origin';
import { tenantPath, bootstrapTenant, communityBotTokensPath, isAdmin } from '@/lib/tenant';
import { parseSessionCookie, serializeSessionCookie, STREAMWEAVER_SESSION_MAX_AGE } from '@/lib/session-cookie';
import { THE_COUNT_TWITCH_LOGIN } from '@/lib/the-count';
import { storeTheCountTwitchCredential } from '@/lib/the-count-twitch-vault.server';
import {
  readPrivilegedTwitchOAuthTransaction,
  TWITCH_PRIVILEGED_OAUTH_COOKIE,
} from '@/lib/twitch-privileged-oauth.server';
import { internalServiceHeaders } from '@/lib/internal-service-auth';

async function reconnectTwitchTenant(tenantId: string): Promise<void> {
  try {
    console.log(`[OAuth] Triggering IRC reconnect for tenant ${tenantId}...`);
    const wsPort = process.env.WS_PORT || '8090';
    const response = await fetch(`http://127.0.0.1:${wsPort}/api/twitch/reconnect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenantId }),
    });
    console.log(`[OAuth] IRC reconnect response: ${response.status}`);
  } catch (error) {
    // The tokens are already durable. The runtime maintenance loop can retry,
    // but a reconnect failure must not discard the completed authorization.
    console.warn('[OAuth] Twitch IRC reconnect failed:', error);
  }
}

async function reconnectTheCountRuntime(): Promise<void> {
  try {
    const wsPort = process.env.WS_PORT || '8090';
    const response = await fetch(`http://127.0.0.1:${wsPort}/api/twitch/the-count/reconnect`, {
      method: 'POST',
      headers: internalServiceHeaders(),
    });
    if (!response.ok) {
      console.warn('[OAuth] The Count runtime reconnect returned', response.status);
    }
  } catch (error) {
    console.warn('[OAuth] The Count credential is durable; runtime reconnect will retry:', error);
  }
}

function clearPrivilegedOAuthCookie(response: NextResponse): NextResponse {
  response.cookies.set(TWITCH_PRIVILEGED_OAUTH_COOKIE, '', {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: 0,
    path: '/',
  });
  return response;
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get('code');
  const error = searchParams.get('error');
  const errorDescription = searchParams.get('error_description');
  const requestedState = searchParams.get('state') || 'login';

  console.info('[Twitch OAuth] Callback received', {
    hasCode: Boolean(code),
    providerError: error || null,
  });

  if (error) {
    return NextResponse.json({ error, error_description: errorDescription }, { status: 400 });
  }

  if (!code) {
    return NextResponse.json({ error: 'No authorization code provided' }, { status: 400 });
  }

  const sessionCookie = request.cookies.get('streamweaver-session')?.value;
  const preflightTenantId = parseSessionCookie(sessionCookie)?.id || null;
  const privilegedTransaction = preflightTenantId
    ? readPrivilegedTwitchOAuthTransaction(
        request.cookies.get(TWITCH_PRIVILEGED_OAUTH_COOKIE)?.value,
        requestedState,
        preflightTenantId,
      )
    : null;
  const ordinaryStates = new Set(['login', 'broadcaster', 'bot']);
  const state = privilegedTransaction?.role || (ordinaryStates.has(requestedState) ? requestedState : null);
  if (!state) {
    const appOrigin = getConfiguredAppUrl(request.nextUrl.origin);
    return clearPrivilegedOAuthCookie(
      NextResponse.redirect(`${appOrigin}/integrations?error=invalid_oauth_state`),
    );
  }
  if ((state === 'community-bot' || state === 'the-count') && (!preflightTenantId || !isAdmin(preflightTenantId))) {
    const appOrigin = getConfiguredAppUrl(request.nextUrl.origin);
    return clearPrivilegedOAuthCookie(
      NextResponse.redirect(`${appOrigin}/integrations?error=admin_only`),
    );
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

      // A tenant may be paused in the in-memory reauthorization gate. Reload
      // the durable token immediately so chat commands such as !points recover
      // without waiting for a restart or maintenance sweep.
      await reconnectTwitchTenant(twitchId);

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
    const tenantId = preflightTenantId;

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
    const isTheCount = state === 'the-count';

    if (isTheCount) {
      const login = String(userInfo?.login || '').trim().toLowerCase();
      const userId = String(userInfo?.id || '').trim();
      if (!userId || login !== THE_COUNT_TWITCH_LOGIN) {
        return clearPrivilegedOAuthCookie(
          NextResponse.redirect(
            `${appOrigin}/integrations?error=wrong_count_account&msg=Authorize+the+Twitch+account+TheCountSPMT+only.`,
          ),
        );
      }

      await storeTheCountTwitchCredential({
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token,
        expiresAt: tokenExpiry,
        userId,
        login,
        scopes: Array.isArray(tokenData.scope)
          ? tokenData.scope.map((scope: unknown) => String(scope))
          : [],
        updatedAt: new Date().toISOString(),
      });
      await reconnectTheCountRuntime();

      return clearPrivilegedOAuthCookie(
        NextResponse.redirect(`${appOrigin}/integrations?success=the-count`),
      );
    }

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
      return clearPrivilegedOAuthCookie(
        NextResponse.redirect(`${appOrigin}/integrations?success=true`),
      );
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

    // Reload the tenant's durable grant and clear any in-memory reauth pause.
    await reconnectTwitchTenant(tenantId);

    return NextResponse.redirect(`${appOrigin}/integrations?success=true`);
  } catch (error) {
    console.error('OAuth callback error:', error);
    return NextResponse.json({ error: 'Internal server error during token exchange' }, { status: 500 });
  }
}
