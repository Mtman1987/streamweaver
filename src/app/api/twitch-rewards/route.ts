import { NextRequest } from 'next/server';
import { apiError, apiOk } from '@/lib/api-response';
import { getStoredTokens, ensureValidToken } from '@/lib/token-utils.server';

export async function GET(req: NextRequest) {
  try {
    const tokens = await getStoredTokens();
    if (!tokens) return apiError('No OAuth tokens', { status: 401, code: 'NO_TOKENS' });

    const clientId = tokens.twitchClientId || process.env.TWITCH_CLIENT_ID;
    const clientSecret = process.env.TWITCH_CLIENT_SECRET;
    if (!clientId || !clientSecret) return apiError('Missing credentials', { status: 500, code: 'MISSING_CREDENTIALS' });

    const accessToken = await ensureValidToken(clientId, clientSecret, 'broadcaster', tokens);

    // Get broadcaster ID
    const validateRes = await fetch('https://id.twitch.tv/oauth2/validate', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!validateRes.ok) return apiError('Token validation failed', { status: 401, code: 'TOKEN_INVALID' });
    const validateData = await validateRes.json() as any;
    const broadcasterId = validateData.user_id;

    // Fetch custom rewards
    const rewardsRes = await fetch(
      `https://api.twitch.tv/helix/channel_points/custom_rewards?broadcaster_id=${broadcasterId}`,
      { headers: { 'Client-ID': clientId, Authorization: `Bearer ${accessToken}` } }
    );
    if (!rewardsRes.ok) {
      const text = await rewardsRes.text();
      return apiError(`Failed to fetch rewards: ${text}`, { status: 502, code: 'TWITCH_API_ERROR' });
    }

    const rewardsData = await rewardsRes.json() as any;
    const rewards = (rewardsData.data || []).map((r: any) => ({
      id: r.id,
      title: r.title,
      cost: r.cost,
      isEnabled: r.is_enabled,
      requiresInput: r.is_user_input_required,
    }));

    return apiOk({ rewards });
  } catch (err: any) {
    return apiError(err?.message || 'Internal error', { status: 500, code: 'INTERNAL_ERROR' });
  }
}
