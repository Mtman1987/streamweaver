import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';

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
    // Always redirect back to 127.0.0.1 for app functionality
    const appOrigin = 'http://127.0.0.1:3100';
    const redirectUri = 'http://localhost:3100/auth/twitch/callback';

    // Exchange the authorization code for an access token
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

    // Store tokens in a local JSON file instead of Firestore
    const tokensDir = path.join(process.cwd(), 'tokens');
    const tokensFile = path.join(tokensDir, 'twitch-tokens.json');

    // Ensure the tokens directory exists
    try {
      await fs.access(tokensDir);
    } catch {
      await fs.mkdir(tokensDir, { recursive: true });
    }

    // Calculate token expiry time
    const tokenExpiry = Date.now() + (tokenData.expires_in - 60) * 1000; // Buffer of 1 minute

    // Read existing tokens if they exist
    let existingTokens = {};
    try {
      const existingData = await fs.readFile(tokensFile, 'utf-8');
      existingTokens = JSON.parse(existingData);
    } catch (error) {
      // File doesn't exist, start with empty object
    }

    // Determine role
    const state = searchParams.get('state');
    const isBroadcaster = state === 'broadcaster' || !state;
    const isBot = state === 'bot';
    const isCommunityBot = state === 'community-bot';
    const isGamesUser = state === 'games';
    const isAppLogin = state === 'login';
    
    // Get user info from Twitch API
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

    // Handle app login differently
    if (isAppLogin && userInfo) {
      // Store login tokens in token file
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
        secure: false,
        sameSite: 'lax',
        maxAge: 60 * 60 * 24 * 7 // 7 days
      });
      return response;
    }

    // Handle games user differently
    if (isGamesUser && userInfo) {
      // Store games user in localStorage via redirect
      const gamesUser = {
        id: userInfo.id,
        username: userInfo.login,
        displayName: userInfo.display_name,
        avatar: userInfo.profile_image_url
      };
      
      return NextResponse.redirect(`${appOrigin}/games?user=${encodeURIComponent(JSON.stringify(gamesUser))}`);
    }

    // Get username from token validation
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

    // Write tokens to file
    await fs.writeFile(tokensFile, JSON.stringify(tokenStorage, null, 2));

    // Redirect back to integrations page with success message
    return NextResponse.redirect(`${appOrigin}/integrations?success=true`);

  } catch (error) {
    console.error('OAuth callback error:', error);
    return NextResponse.json({
      error: 'Internal server error during token exchange'
    }, { status: 500 });
  }
}
