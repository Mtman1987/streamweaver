import { NextRequest } from 'next/server';
import { getStoredTokens, ensureValidToken } from '@/lib/token-utils.server';
import { apiError, apiOk } from '@/lib/api-response';

export async function GET(req: NextRequest) {
    try {
        const { searchParams } = new URL(req.url);
        const username = searchParams.get('username');
        
        if (!username) {
            return apiError('Username required', { status: 400, code: 'MISSING_USERNAME' });
        }

        const clientId = process.env.TWITCH_CLIENT_ID;
        const clientSecret = process.env.TWITCH_CLIENT_SECRET;

        if (!clientId || !clientSecret) {
            return apiError('Twitch credentials not configured', { status: 500, code: 'MISSING_CREDENTIALS' });
        }

        const tokens = await getStoredTokens();
        if (!tokens) {
            return apiError('No Twitch tokens available', { status: 401, code: 'MISSING_TOKENS' });
        }

        const broadcasterToken = await ensureValidToken(clientId, clientSecret, 'broadcaster', tokens);
        
        // Get user ID
        const userResponse = await fetch(`https://api.twitch.tv/helix/users?login=${username}`, {
            headers: {
                'Authorization': `Bearer ${broadcasterToken}`,
                'Client-ID': clientId,
            },
        });

        console.log(`[Clips API] User lookup for ${username}: ${userResponse.status}`);

        if (!userResponse.ok) {
            const errorText = await userResponse.text();
            console.error(`[Clips API] User lookup failed: ${errorText}`);
            return apiError('Failed to get user info', {
                status: 500,
                code: 'TWITCH_USER_LOOKUP_FAILED',
                details: { details: errorText },
            });
        }

        const userData = await userResponse.json();
        const userId = userData.data[0]?.id;

        console.log(`[Clips API] User ID for ${username}: ${userId}`);

        if (!userId) {
            return apiOk({ clips: [] });
        }

        // Get clips (last 2 years)
        const endDate = new Date();
        const startDate = new Date();
        startDate.setFullYear(startDate.getFullYear() - 2);
        
        const clipsResponse = await fetch(
            `https://api.twitch.tv/helix/clips?broadcaster_id=${userId}&first=100&started_at=${startDate.toISOString()}&ended_at=${endDate.toISOString()}`,
            {
                headers: {
                    'Authorization': `Bearer ${broadcasterToken}`,
                    'Client-ID': clientId,
                },
            }
        );

        console.log(`[Clips API] Clips lookup for ${username} (${userId}): ${clipsResponse.status}`);

        if (!clipsResponse.ok) {
            const errorText = await clipsResponse.text();
            console.error(`[Clips API] Clips lookup failed: ${errorText}`);
            return apiOk({ clips: [] });
        }

        const clipsData = await clipsResponse.json();
        console.log(`[Clips API] Found ${clipsData.data?.length || 0} clips for ${username}`);
        return apiOk({ clips: clipsData.data || [] });

    } catch (error: any) {
        console.error('[Twitch Clips API] Error:', error);
        return apiError(error.message, { status: 500, code: 'INTERNAL_ERROR' });
    }
}
