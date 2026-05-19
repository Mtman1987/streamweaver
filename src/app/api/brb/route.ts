import { NextRequest } from 'next/server';
import { toggleClipMode, getClipMode } from '@/services/brb-clips';
import { getStoredTokens } from '@/lib/token-utils.server';
import { getTenantFromRequest } from '@/lib/tenant-context';
import { apiError, apiOk } from '@/lib/api-response';
import { z } from 'zod';

const brbSchema = z.object({
    action: z.enum(['start', 'stop', 'toggle-mode', 'get-mode']),
});

const WS_PORT = process.env.WS_PORT || process.env.NEXT_PUBLIC_STREAMWEAVE_WS_PORT || '8090';

export async function POST(req: NextRequest) {
    try {
        const parsed = brbSchema.safeParse(await req.json().catch(() => null));
        if (!parsed.success) {
            return apiError('Invalid action', { status: 400, code: 'INVALID_BODY' });
        }

        const { action } = parsed.data;
        const session = getTenantFromRequest(req);
        const tenantId = session?.tenantId;
        
        if (action === 'start') {
            const tokens = await getStoredTokens(tenantId);
            if (!tokens?.broadcasterUsername) {
                return apiError('Broadcaster username not found', { status: 400, code: 'BROADCASTER_USERNAME_MISSING' });
            }
            // Proxy to parent process where global.broadcast lives
            await fetch(`http://127.0.0.1:${WS_PORT}/api/brb`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'start', broadcasterUsername: tokens.broadcasterUsername, tenantId }),
            });
            return apiOk({ success: true, message: 'BRB started' });
        }
        
        if (action === 'stop') {
            await fetch(`http://127.0.0.1:${WS_PORT}/api/brb`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'stop', tenantId }),
            });
            return apiOk({ success: true, message: 'BRB stopped' });
        }
        
        if (action === 'toggle-mode') {
            await toggleClipMode(tenantId);
            const mode = await getClipMode(tenantId);
            return apiOk({ success: true, mode });
        }
        
        if (action === 'get-mode') {
            const mode = await getClipMode(tenantId);
            return apiOk({ success: true, mode });
        }
        
        return apiError('Invalid action', { status: 400, code: 'INVALID_ACTION' });
    } catch (error: any) {
        console.error('[BRB API] Error:', error);
        return apiError(error.message, { status: 500, code: 'INTERNAL_ERROR' });
    }
}
