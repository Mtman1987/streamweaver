import { NextRequest } from 'next/server';
import { openBoosterPack } from '@/services/pokemon-tcg';
import { apiError, apiOk } from '@/lib/api-response';
import { z } from 'zod';

const openPackSchema = z.object({
  username: z.string().trim().min(1),
  set: z.string().trim().max(128).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const parsed = openPackSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return apiError('Username required', { status: 400, code: 'INVALID_BODY' });
    }

    const { username, set } = parsed.data;
    
    const cards = await openBoosterPack(username, set);
    
    if (!cards) {
      return apiError('No packs available', { status: 400, code: 'NO_PACKS_AVAILABLE' });
    }
    
    return apiOk({ cards, set: set || 'random' });
  } catch (error: any) {
    console.error('[Pokemon] Pack open error:', error);
    return apiError(error.message, { status: 500, code: 'INTERNAL_ERROR' });
  }
}
