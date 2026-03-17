import { NextRequest } from 'next/server';
import { getStoredTokens } from '@/lib/token-utils.server';
import { apiError, apiOk } from '@/lib/api-response';

export async function GET(request: NextRequest) {
  try {
    const tokens = await getStoredTokens();
    if (!tokens) {
      return apiError('No tokens available', { status: 404, code: 'TOKENS_NOT_FOUND' });
    }

    // Return only necessary auth data
    return apiOk({
      twitch: {
        broadcasterUsername: tokens.broadcasterUsername,
        botUsername: tokens.botUsername,
        connected: Boolean(tokens.broadcasterToken || tokens.botToken)
      },
      discord: {
        connected: Boolean(process.env.DISCORD_BOT_TOKEN)
      }
    });
  } catch (error) {
    console.error('[Auth Share] Error:', error);
    return apiError('Internal server error', { status: 500, code: 'INTERNAL_ERROR' });
  }
}