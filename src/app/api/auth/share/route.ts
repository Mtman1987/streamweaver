import { NextRequest } from 'next/server';
import { getStoredTokens } from '@/lib/token-utils.server';
import { getTenantFromRequest } from '@/lib/tenant-context';
import { apiError, apiOk } from '@/lib/api-response';

export async function GET(request: NextRequest) {
  try {
    const session = getTenantFromRequest(request);
    const tokens = await getStoredTokens(session?.tenantId);
    if (!tokens) {
      return apiError('No tokens available', { status: 404, code: 'TOKENS_NOT_FOUND' });
    }

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
