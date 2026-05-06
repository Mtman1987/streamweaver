import { NextRequest, NextResponse } from 'next/server';
import { apiError, apiOk } from '@/lib/api-response';
import { getOAuthRedirectUri } from '@/lib/runtime-origin';
import { z } from 'zod';

const discordManualExchangeSchema = z.object({
  code: z.string().trim().min(1, 'Authorization code is required').max(4096, 'Authorization code too long'),
  state: z.enum(['discord-user', 'discord-bot']).optional().default('discord-user'),
});

export async function POST(request: NextRequest) {
  try {
    const parsed = discordManualExchangeSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return apiError('Invalid request body', { status: 400, code: 'INVALID_BODY' });
    }

    const { code, state } = parsed.data;

    const clientId = process.env.DISCORD_CLIENT_ID;
    const clientSecret = process.env.DISCORD_CLIENT_SECRET;
    const redirectUri = getOAuthRedirectUri('discord', request.nextUrl.origin);

    if (!clientId || !clientSecret) {
      return apiError('Discord credentials not configured', { status: 500, code: 'MISSING_CONFIG' });
    }

    const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code: code,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri
      })
    });

    if (!tokenResponse.ok) {
      return apiError('Failed to exchange Discord token', {
        status: 500,
        code: 'TOKEN_EXCHANGE_FAILED',
      });
    }

    const tokenData = await tokenResponse.json();

    const userResponse = await fetch('https://discord.com/api/users/@me', {
      headers: { 'Authorization': `Bearer ${tokenData.access_token}` }
    });

    let username = 'Discord User';
    if (userResponse.ok) {
      const userData = await userResponse.json();
      username = userData.username || 'Discord User';
    }

    return apiOk({ success: true, username, role: state });

  } catch {
    return apiError('Discord token exchange failed', { status: 500, code: 'INTERNAL_ERROR' });
  }
}