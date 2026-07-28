import { NextRequest } from 'next/server';
import { getStoredTokens, ensureValidToken } from '@/lib/token-utils.server';
import { getTenantFromRequest } from '@/lib/tenant-context';
import { apiError, apiOk } from '@/lib/api-response';
import { hasInternalServiceAccess } from '@/lib/internal-service-auth';

export async function POST(req: NextRequest) {
    try {
        const url = new URL(req.url);
        const clientId = process.env.TWITCH_CLIENT_ID;
        const clientSecret = process.env.TWITCH_CLIENT_SECRET;

        if (!clientId || !clientSecret) {
            return apiError('Twitch credentials not configured', { status: 500, code: 'MISSING_CREDENTIALS' });
        }

        const session = getTenantFromRequest(req);
        const tenantId = session?.tenantId || (hasInternalServiceAccess(req) ? url.searchParams.get('tenantId')?.trim() || undefined : undefined);
        if (!tenantId) return apiError('Authentication required', { status: 401, code: 'UNAUTHORIZED' });
        const tokens = await getStoredTokens(tenantId);
        if (!tokens) {
            return apiError('No Twitch tokens available', { status: 401, code: 'MISSING_TOKENS' });
        }

        const broadcasterToken = await ensureValidToken(clientId, clientSecret, 'broadcaster', tokens, tenantId);
        
        // Get broadcaster ID
        const userResponse = await fetch(`https://api.twitch.tv/helix/users`, {
            headers: {
                'Authorization': `Bearer ${broadcasterToken}`,
                'Client-ID': clientId,
            },
        });

        if (!userResponse.ok) {
            const errorText = await userResponse.text().catch(() => '');
            console.error('[Twitch] Failed to get broadcaster info for clip:', {
                tenantId: tenantId || 'global',
                status: userResponse.status,
                body: errorText,
            });
            return apiError('Failed to get broadcaster info', {
                status: userResponse.status,
                code: 'TWITCH_USER_LOOKUP_FAILED',
                details: { twitchStatus: userResponse.status, twitchError: errorText },
            });
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
            const errorData = await clipResponse.json().catch(async () => ({ message: await clipResponse.text().catch(() => '') }));
            console.error('[Twitch] Failed to create clip:', JSON.stringify({
                tenantId: tenantId || 'global',
                broadcasterId,
                status: clipResponse.status,
                error: errorData,
            }));
            return apiError('Failed to create clip', {
                status: clipResponse.status,
                code: 'TWITCH_CLIP_CREATE_FAILED',
                details: { twitchStatus: clipResponse.status, twitchError: errorData },
            });
        }

        const clipData = await clipResponse.json();
        console.log('[Twitch] Clip created:', clipData);
        const clip = clipData.data?.[0] || null;

        return apiOk({ 
            success: true, 
            clip,
            url: clip?.edit_url || (clip?.id ? `https://clips.twitch.tv/${clip.id}` : undefined),
        });

    } catch (error: any) {
        console.error('[Twitch] Error creating clip:', error);
        return apiError(error.message || 'Failed to create clip', { status: 500, code: 'INTERNAL_ERROR' });
    }
}
