import { NextRequest } from 'next/server';
import { startBRB, stopBRB, toggleClipMode, getClipMode } from '@/services/brb-clips';
import { getStoredTokens } from '@/lib/token-utils.server';
import { setupObsWebSocket } from '@/services/obs';
import { apiError, apiOk } from '@/lib/api-response';
import { z } from 'zod';

const brbSchema = z.object({
    action: z.enum(['start', 'stop', 'toggle-mode', 'get-mode']),
});

export async function POST(req: NextRequest) {
    try {
        const parsed = brbSchema.safeParse(await req.json().catch(() => null));
        if (!parsed.success) {
            return apiError('Invalid action', { status: 400, code: 'INVALID_BODY' });
        }

        const { action } = parsed.data;
        
        if (action === 'start') {
            // Ensure OBS is connected
            await setupObsWebSocket();
            
            const tokens = await getStoredTokens();
            if (!tokens?.broadcasterUsername) {
                return apiError('Broadcaster username not found', { status: 400, code: 'BROADCASTER_USERNAME_MISSING' });
            }
            
            await startBRB(tokens.broadcasterUsername);
            return apiOk({ success: true, message: 'BRB started' });
        }
        
        if (action === 'stop') {
            stopBRB();
            return apiOk({ success: true, message: 'BRB stopped' });
        }
        
        if (action === 'toggle-mode') {
            toggleClipMode();
            const mode = getClipMode();
            return apiOk({ success: true, mode });
        }
        
        if (action === 'get-mode') {
            const mode = getClipMode();
            return apiOk({ success: true, mode });
        }
        
        return apiError('Invalid action', { status: 400, code: 'INVALID_ACTION' });
    } catch (error: any) {
        console.error('[BRB API] Error:', error);
        return apiError(error.message, { status: 500, code: 'INTERNAL_ERROR' });
    }
}
