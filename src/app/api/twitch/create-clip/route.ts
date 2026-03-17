import { NextRequest } from 'next/server';
import { getStoredTokens, ensureValidToken } from '@/lib/token-utils.server';
import { apiError, apiOk } from '@/lib/api-response';

export async function POST(req: NextRequest) {
    try {
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
        
        // Get broadcaster ID
        const userResponse = await fetch(`https://api.twitch.tv/helix/users`, {
            headers: {
                'Authorization': `Bearer ${broadcasterToken}`,
                'Client-ID': clientId,
            },
        });

        if (!userResponse.ok) {
            return apiError('Failed to get broadcaster info', { status: 500, code: 'TWITCH_USER_LOOKUP_FAILED' });
        }

        const userData = await userResponse.json();
        const broadcasterId = userData.data[0]?.id;

        if (!broadcasterId) {
            return apiError('Broadcaster ID not found', { status: 500, code: 'BROADCASTER_ID_NOT_FOUND' });
        }

        // Create clip (has_delay=false means clip the last 60 seconds instead of 30)
        const clipResponse = await fetch(`https://api.twitch.tv/helix/clips?broadcaster_id=${broadcasterId}&has_delay=false`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${broadcasterToken}`,
                'Client-ID': clientId,
            },
        });

        if (!clipResponse.ok) {
            const errorData = await clipResponse.json();
            console.error('Failed to create clip:', errorData);
            return apiError('Failed to create clip', {
                status: clipResponse.status,
                code: 'TWITCH_CLIP_CREATE_FAILED',
                details: { details: errorData },
            });
        }

        const clipData = await clipResponse.json();
        console.log('[Twitch] Clip created:', clipData);

        return apiOk({ 
            success: true, 
            clip: clipData.data[0] 
        });

    } catch (error: any) {
        console.error('[Twitch] Error creating clip:', error);
        return apiError(error.message || 'Failed to create clip', { status: 500, code: 'INTERNAL_ERROR' });
    }
}
