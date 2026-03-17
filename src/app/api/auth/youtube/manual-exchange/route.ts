import { NextRequest, NextResponse } from 'next/server';
import { apiError, apiOk } from '@/lib/api-response';
import { z } from 'zod';

const youtubeManualExchangeSchema = z.object({
  code: z.string().trim().min(1, 'Authorization code is required').max(4096, 'Authorization code too long'),
  state: z.enum(['youtube-broadcaster', 'youtube-bot']).optional().default('youtube-broadcaster'),
});

export async function POST(request: NextRequest) {
  try {
    const parsed = youtubeManualExchangeSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return apiError('Invalid request body', { status: 400, code: 'INVALID_BODY' });
    }

    const { code, state } = parsed.data;

    const clientId = process.env.YOUTUBE_CLIENT_ID;
    const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;
    const redirectUri = 'http://localhost:3100/auth/youtube/callback';

    if (!clientId || !clientSecret) {
      return apiError('YouTube credentials not configured', { status: 500, code: 'MISSING_CONFIG' });
    }

    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
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
      return apiError('Failed to exchange YouTube token', {
        status: 500,
        code: 'TOKEN_EXCHANGE_FAILED',
      });
    }

    const tokenData = await tokenResponse.json();

    const userResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { 'Authorization': `Bearer ${tokenData.access_token}` }
    });

    let username = 'YouTube User';
    if (userResponse.ok) {
      const userData = await userResponse.json();
      username = userData.name || 'YouTube User';
    }

    return apiOk({ success: true, username, role: state });

  } catch {
    return apiError('YouTube token exchange failed', { status: 500, code: 'INTERNAL_ERROR' });
  }
}