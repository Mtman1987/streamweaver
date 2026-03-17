import { NextRequest } from 'next/server';
import { handleGamble, getSettings, updateSettings } from '@/services/gamble/classic-gamble';
import { getUserPoints, updateUserPoints } from '@/services/points';
import { apiError, apiOk } from '@/lib/api-response';
import { z } from 'zod';

const classicGambleSchema = z.object({
    action: z.enum(['get-settings', 'update-settings', 'gamble']),
    user: z.string().trim().optional(),
    betInput: z.string().optional(),
    settings: z.unknown().optional(),
});

export async function POST(req: NextRequest) {
    try {
        const parsed = classicGambleSchema.safeParse(await req.json().catch(() => null));
        if (!parsed.success) {
            return apiError('Invalid request body', { status: 400, code: 'INVALID_BODY' });
        }

        const { action, user, betInput, settings: newSettings } = parsed.data;
        
        if (action === 'get-settings') {
            const settings = getSettings();
            return apiOk({ success: true, settings });
        }
        
        if (action === 'update-settings') {
            if (!newSettings) {
                return apiError('Settings required', { status: 400, code: 'SETTINGS_REQUIRED' });
            }
            await updateSettings(newSettings);
            return apiOk({ success: true });
        }
        
        if (action === 'gamble') {
            if (!user) {
                return apiError('User required', { status: 400, code: 'USER_REQUIRED' });
            }
            
            const userPoints = await getUserPoints(user);
            const result = await handleGamble(user, betInput || '', userPoints);
            
            if (result) {
                await updateUserPoints(user, result.newTotal);
                return apiOk({ success: true, result });
            }
            
            return apiOk({ success: false });
        }
        
        return apiError('Invalid action', { status: 400, code: 'INVALID_ACTION' });
    } catch (error: any) {
        console.error('[Classic Gamble API] Error:', error);
        return apiError(error.message, { status: 500, code: 'INTERNAL_ERROR' });
    }
}

export async function GET(req: NextRequest) {
    try {
        const settings = getSettings();
        return apiOk({ success: true, settings });
    } catch (error: any) {
        console.error('[Classic Gamble API] Error:', error);
        return apiError(error.message, { status: 500, code: 'INTERNAL_ERROR' });
    }
}
