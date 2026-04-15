import { NextRequest } from 'next/server';
import { getStoredTokens, ensureValidToken } from '@/lib/token-utils.server';
import { getTenantFromRequest } from '@/lib/tenant-context';
import { apiError, apiOk } from '@/lib/api-response';
import { getConfigSection, initializeLocalConfig } from '@/lib/local-config/service';

export async function GET(request: NextRequest) {
  try {
    await initializeLocalConfig();
    const twitchConfig = await getConfigSection('twitch');
    const { clientId, clientSecret } = twitchConfig;

    if (!clientId || !clientSecret || clientId.includes('placeholder') || clientSecret.includes('placeholder')) {
      return apiError('Twitch configuration missing or incomplete. Please set up your Twitch app credentials in Settings.', { status: 500, code: 'MISSING_CREDENTIALS' });
    }

    const session = getTenantFromRequest(request);
    const storedTokens = await getStoredTokens(session?.tenantId);
    if (!storedTokens) {
      return apiError('No stored tokens found', { status: 500, code: 'MISSING_TOKENS' });
    }

    const broadcasterToken = await ensureValidToken(clientId, clientSecret, 'broadcaster', storedTokens, session?.tenantId);
    if (!broadcasterToken) {
      return apiError('Broadcaster token not found', { status: 500, code: 'MISSING_BROADCASTER_TOKEN' });
    }

    // Get user ID from token validation
    const validateResponse = await fetch('https://id.twitch.tv/oauth2/validate', {
      headers: { Authorization: `Bearer ${broadcasterToken}` },
    });
    
    if (!validateResponse.ok) {
      return apiError('Token validation failed', { status: 500, code: 'TOKEN_VALIDATION_FAILED' });
    }
    
    const tokenData = await validateResponse.json();
    const userId = tokenData.user_id;
    
    if (!userId) {
      return apiError('No user ID in token', { status: 500, code: 'TOKEN_USER_ID_MISSING' });
    }

    const url = `https://api.twitch.tv/helix/chat/chatters?broadcaster_id=${userId}&moderator_id=${userId}`;

    console.log('[Chatters API] Fetching from:', url);
    console.log('[Chatters API] Using user ID:', userId);

    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${broadcasterToken}`,
        'Client-ID': clientId,
      },
    });

    console.log('[Chatters API] Response status:', response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.warn('[Chatters API] Twitch API error:', response.status, errorText);

      return apiError('Twitch API request failed', {
        status: 502,
        code: 'TWITCH_API_FAILED',
        details: { status: response.status, details: errorText },
      });
    }

    const data = await response.json();
    console.log('[Chatters API] Success, found', data.data?.length || 0, 'chatters');
    return apiOk({ chatters: data.data || [] });

  } catch (error) {
    console.error('[Chatters API] Error:', error);

    return apiError('Failed to fetch chatters', {
      status: 500,
      code: 'INTERNAL_ERROR',
      details: { details: String((error as any)?.message || error) },
    });
  }
}