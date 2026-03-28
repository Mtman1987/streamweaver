import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { getConfiguredAppUrl, getOAuthRedirectUri } from '@/lib/runtime-origin';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get('code');
  const error = searchParams.get('error');
  const errorDescription = searchParams.get('error_description');

  if (error) {
    return NextResponse.json({
      error,
      error_description: errorDescription
    }, { status: 400 });
  }

  if (!code) {
    return NextResponse.json({
      error: 'No authorization code provided'
    }, { status: 400 });
  }

  try {
    const appOrigin = getConfiguredAppUrl(request.nextUrl.origin);
    const redirectUri = getOAuthRedirectUri('twitch', request.nextUrl.origin);

    const clientId = process.env.TWITCH_CLIENT_ID;
    const clientSecret = process.env.TWITCH_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      return NextResponse.json({
        error: 'Twitch client credentials not configured'
      }, { status: 500 });
    }

    const tokenResponse = await fetch('https://id.twitch.tv/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code: code,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri
      })
    });

    if (!tokenResponse.ok) {
      const errorData = await tokenResponse.text();
      return NextResponse.json({
        error: 'Failed to exchange code for token',
        details: errorData
      }, { status: 500 });
    }

    const tokenData = await tokenResponse.json();

    const tokensDir = path.join(process.cwd(), 'tokens');
    const tokensFile = path.join(tokensDir, 'twitch-tokens.json');

    try {
      await fs.access(tokensDir);
    } catch {
      await fs.mkdir(tokensDir, { recursive: true });
    }

    const tokenExpiry = Date.now() + (tokenData.expires_in - 60) * 1000;

    let existingTokens = {};
    try {
      const existingData = await fs.readFile(tokensFile, 'utf-8');
      existingTokens = JSON.parse(existingData);
    } catch {}

    const state = searchParams.get('state');
    const isBroadcaster = state === 'broadcaster' || !state;
    const isBot = state === 'bot';
    const isCommunityBot = state === 'community-bot';
    const isGamesUser = state === 'games';
    const isAppLogin = state === 'login';
    
    const userResponse = await fetch('https://api.twitch.tv/helix/users', {
      headers: {
        'Authorization': `Bearer ${tokenData.access_token}`,
        'Client-Id': clientId,
      },
    });
    
    let userInfo = null;
    if (userResponse.ok) {
      const userData = await userResponse.json();
      userInfo = userData.data[0];
    }

    if (isAppLogin && userInfo) {
      const tokenStorage = {
        ...existingTokens,
        loginToken: tokenData.access_token,
        loginRefreshToken: tokenData.refresh_token,
        loginTokenExpiry: tokenExpiry,
        loginUsername: userInfo.login,
        lastUpdated: new Date().toISOString()
      };
      
      await fs.writeFile(tokensFile, JSON.stringify(tokenStorage, null, 2));

      const sessionData = {
        id: userInfo.id,
        username: userInfo.login,
        displayName: userInfo.display_name,
        avatar: userInfo.profile_image_url,
        loginTime: Date.now()
      };

      const response = NextResponse.redirect(`${appOrigin}/?login=success`);
      response.cookies.set('streamweaver-session', JSON.stringify(sessionData), {
        httpOnly: true,
        secure: appOrigin.startsWith('https://'),
        sameSite: 'lax',
        maxAge: 60 * 60 * 24 * 7
      });
      return response;
    }

    if (isGamesUser && userInfo) {
      const gamesUser = {
        id: userInfo.id,
        username: userInfo.login,
        displayName: userInfo.display_name,
        avatar: userInfo.profile_image_url
      };
      
      return NextResponse.redirect(`${appOrigin}/games?user=${encodeURIComponent(JSON.stringify(gamesUser))}`);
    }

    const validateResponse = await fetch('https://id.twitch.tv/oauth2/validate', {
      headers: {
        'Authorization': `Bearer ${tokenData.access_token}`,
      },
    });

    let username = '';
    if (validateResponse.ok) {
      const validateData = await validateResponse.json();
      username = validateData.login;
    }

    const tokenStorage = {
      ...existingTokens,
      ...(isBroadcaster ? {
        broadcasterToken: tokenData.access_token,
        broadcasterRefreshToken: tokenData.refresh_token,
        broadcasterTokenExpiry: tokenExpiry,
        broadcasterUsername: username,
      } : isBot ? {
        botToken: tokenData.access_token,
        botRefreshToken: tokenData.refresh_token,
        botTokenExpiry: tokenExpiry,
        botUsername: username,
      } : isCommunityBot ? {
        communityBotToken: tokenData.access_token,
        communityBotRefreshToken: tokenData.refresh_token,
        communityBotTokenExpiry: tokenExpiry,
        communityBotUsername: username,
      } : {}),
      lastUpdated: new Date().toISOString()
    };

    await fs.writeFile(tokensFile, JSON.stringify(tokenStorage, null, 2));

    return NextResponse.redirect(`${appOrigin}/integrations?success=true`);

  } catch (error) {
    console.error('OAuth callback error:', error);
    return NextResponse.json({
      error: 'Internal server error during token exchange'
    }, { status: 500 });
  }
}