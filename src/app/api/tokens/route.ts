import { NextRequest } from 'next/server';
import { getStoredTokens } from '@/lib/token-utils.server';
import { apiError, apiOk } from '@/lib/api-response';
import { getTenantFromRequest } from '@/lib/tenant-context';

export async function GET(request: NextRequest) {
  try {
    const session = getTenantFromRequest(request);
    const tokens = await getStoredTokens(session?.tenantId);
    if (!tokens) {
      return apiError('No tokens found', { status: 404, code: 'TOKENS_NOT_FOUND' });
    }

    // Return safe token status only.
    const tokenStatus = {
      botConnected: Boolean(tokens.botToken),
      broadcasterConnected: Boolean(tokens.broadcasterToken),
      botUsername: tokens.botUsername,
      broadcasterUsername: tokens.broadcasterUsername,
    };

    return apiOk(tokenStatus);
  } catch (error) {
    console.error('Error fetching tokens:', error);
    return apiError('Failed to fetch tokens', { status: 500, code: 'INTERNAL_ERROR' });
  }
}
