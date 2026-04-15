import { NextRequest } from 'next/server';
import { tradeCards } from '@/services/pokemon-tcg';
import { apiError, apiOk } from '@/lib/api-response';
import { z } from 'zod';

const tradeSchema = z.object({
  userA: z.string().trim().min(1),
  userB: z.string().trim().min(1),
  cardIdA: z.string().trim().min(1),
  cardIdB: z.string().trim().min(1),
});

export async function POST(req: NextRequest) {
  try {
    const parsed = tradeSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return apiError('Missing required fields', { status: 400, code: 'INVALID_BODY' });
    }

    const { userA, userB, cardIdA, cardIdB } = parsed.data;
    
    const result = await tradeCards(userA, userB, cardIdA, cardIdB);
    return apiOk(result as Record<string, unknown>);
  } catch (error: any) {
    console.error('[Pokemon] Trade error:', error);
    return apiError(error.message, { status: 500, code: 'INTERNAL_ERROR' });
  }
}
