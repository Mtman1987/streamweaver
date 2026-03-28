import { NextRequest } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { apiError, apiOk } from '@/lib/api-response';
import { getOAuthRedirectUri } from '@/lib/runtime-origin';
import { z } from 'zod';

const manualExchangeSchema = z.object({
  code: z.string().trim().min(1, 'Authorization code is required').max(4096, 'Authorization code is too long'),
  state: z
    .enum(['broadcaster', 'bot', 'community-bot', 'login'])
    .optional()
    .default('broadcaster'),
});

export async function POST(request: NextRequest) {
  try {
    const parsed = manualExchangeSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return apiError('Invalid request body', { status: 400, code: 'INVALID_BODY' });
    }

    const { code, state } = parsed.data;

    const clientId = process.env.TWITCH_CLIENT_ID;
    const clientSecret = process.env.TWITCH_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      return apiError('Twitch client credentials not configured', { status: 500, code: 'MISSING_CREDENTIALS' });
    }

    const tokenResponse = await fetch('https://id.twitch.tv/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code: code,
        grant_type: 'authorization_code',
        redirect_uri: getOAuthRedirectUri('twitch', request.nextUrl.origin)
      })
    });

    if (!tokenResponse.ok) {
      const errorData = await tokenResponse.text();
      return apiError('Failed to exchange code for token', {
        status: 500,
        code: 'TOKEN_EXCHANGE_FAILED',
        details: { details: errorData },
      });
    }

    const tokenData = await tokenResponse.json();

    const userResponse = await fetch('https://api.twitch.tv/helix/users', {
      headers: {
        'Authorization': `Bearer ${tokenData.access_token}`,
        'Client-Id': clientId,
      },
    });
    
    let username = '';
    if (userResponse.ok) {
      const userData = await userResponse.json();
      username = userData.data[0]?.login || '';
    }

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

    const isBroadcaster = state === 'broadcaster';
    const isBot = state === 'bot';
    const isCommunityBot = state === 'community-bot';

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

    return apiOk({ 
      success: true, 
      username,
      role: state
    });

  } catch (error) {
    console.error('Manual token exchange error:', error);
    return apiError('Internal server error', { status: 500, code: 'INTERNAL_ERROR' });
  }
}