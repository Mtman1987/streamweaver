import { NextRequest } from 'next/server';
import { getStoredTokens, ensureValidToken, isTwitchAuthFailure } from '@/lib/token-utils.server';
import { getTenantFromRequest } from '@/lib/tenant-context';
import { apiError, apiOk } from '@/lib/api-response';
import { getConfigSection, initializeLocalConfig } from '@/lib/local-config/service';
import { hasInternalServiceAccess } from '@/lib/internal-service-auth';

export async function GET(request: NextRequest) {
  try {
    const session = getTenantFromRequest(request);
    const internalAccess = hasInternalServiceAccess(request);
    const tenantId = session?.tenantId || (internalAccess ? request.nextUrl.searchParams.get('tenant') || undefined : undefined);
    if (!tenantId) return apiError('Authentication required', { status: 401, code: 'UNAUTHORIZED' });
    await initializeLocalConfig(tenantId);
    const twitchConfig = await getConfigSection('twitch', tenantId);
    const { clientId, clientSecret } = twitchConfig;

    if (!clientId || !clientSecret || clientId.includes('placeholder') || clientSecret.includes('placeholder')) {
      return apiError('Twitch configuration missing or incomplete. Please set up your Twitch app credentials in Settings.', { status: 500, code: 'MISSING_CREDENTIALS' });
    }

    const storedTokens = await getStoredTokens(tenantId);
    if (!storedTokens) {
      return apiError('No stored tokens found', { status: 500, code: 'MISSING_TOKENS' });
    }

    const broadcasterToken = await ensureValidToken(clientId, clientSecret, 'broadcaster', storedTokens, tenantId);
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

    // Chatters API logging removed for noise reduction — only log errors

    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${broadcasterToken}`,
        'Client-ID': clientId,
      },
    });

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
    const chatters = Array.isArray(data.data) ? data.data : [];
    const userIds = chatters.map((chatter: any) => String(chatter.user_id || '').trim()).filter(Boolean);

    const avatarsById = new Map<string, string>();
    for (let index = 0; index < userIds.length; index += 100) {
      const chunk = userIds.slice(index, index + 100);
      if (chunk.length === 0) continue;
      const usersUrl = `https://api.twitch.tv/helix/users?${chunk.map((id: string) => `id=${encodeURIComponent(id)}`).join('&')}`;
      const usersResponse = await fetch(usersUrl, {
        headers: {
          Authorization: `Bearer ${broadcasterToken}`,
          'Client-ID': clientId,
        },
      });
      if (!usersResponse.ok) continue;
      const usersData = await usersResponse.json().catch(() => ({ data: [] }));
      for (const user of Array.isArray(usersData.data) ? usersData.data : []) {
        if (user?.id && user?.profile_image_url) {
          avatarsById.set(String(user.id), String(user.profile_image_url));
        }
      }
    }

    return apiOk({
      chatters: chatters.map((chatter: any) => ({
        ...chatter,
        avatar: avatarsById.get(String(chatter.user_id || '')) || null,
      })),
    });

  } catch (error) {
    if (isTwitchAuthFailure(error)) {
      return apiError('Twitch re-authorization required', {
        status: 401,
        code: 'TWITCH_REAUTH_REQUIRED',
        details: { details: String((error as any)?.message || error) },
      });
    }

    console.error('[Chatters API] Error:', error);

    return apiError('Failed to fetch chatters', {
      status: 500,
      code: 'INTERNAL_ERROR',
      details: { details: String((error as any)?.message || error) },
    });
  }
}
