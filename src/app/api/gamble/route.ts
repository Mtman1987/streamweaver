import { NextRequest } from 'next/server';
import { handleRoll, handleYes, handleNo, handleGambleMode } from '@/services/gamble/space-mountain';
import { getUserPoints, updateUserPoints } from '@/services/points';
import { apiError, apiOk } from '@/lib/api-response';
import { z } from 'zod';

const gambleSchema = z.object({
    command: z.enum(['gamblemode', 'roll', 'yes', 'no']),
    user: z.string().trim().optional(),
    wager: z.number().positive().optional(),
    mode: z.string().trim().optional(),
});

export async function POST(req: NextRequest) {
    try {
        const parsed = gambleSchema.safeParse(await req.json().catch(() => null));
        if (!parsed.success) {
            return apiError('Invalid request body', { status: 400, code: 'INVALID_BODY' });
        }

        const { command, user, wager, mode } = parsed.data;
        
        if (!user) {
            return apiError('User required', { status: 400, code: 'USER_REQUIRED' });
        }

        if (command === 'gamblemode') {
            if (!mode) {
                return apiError('Mode required', { status: 400, code: 'MODE_REQUIRED' });
            }
            await handleGambleMode(user, mode);
            return apiOk({ success: true });
        }

        const userPoints = await getUserPoints(user);

        if (command === 'roll') {
            if (!wager || wager <= 0) {
                return apiError('Valid wager required', { status: 400, code: 'INVALID_WAGER' });
            }
            
            const result = await handleRoll(user, wager, userPoints);
            if (result) {
                await updateUserPoints(user, userPoints + result.change);
            }
            return apiOk({ success: true, result });
        }

        if (command === 'yes') {
            const result = await handleYes(user, userPoints);
            if (result) {
                await updateUserPoints(user, userPoints + result.change);
            }
            return apiOk({ success: true, result });
        }

        if (command === 'no') {
            await handleNo(user);
            return apiOk({ success: true });
        }

        return apiError('Invalid command', { status: 400, code: 'INVALID_COMMAND' });
    } catch (error: any) {
        console.error('[Gamble API] Error:', error);
        return apiError(error.message, { status: 500, code: 'INTERNAL_ERROR' });
    }
}
