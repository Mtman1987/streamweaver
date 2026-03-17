import { NextRequest } from 'next/server';
import { addPacksToUser } from '@/services/pokemon-tcg';
import { apiError, apiOk } from '@/lib/api-response';
import { z } from 'zod';

const addPacksSchema = z.object({
  username: z.string().trim().min(1),
  count: z.coerce.number().int().positive(),
});

export async function POST(req: NextRequest) {
  try {
    const parsed = addPacksSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return apiError('Username and count required', { status: 400, code: 'INVALID_BODY' });
    }

    const { username, count } = parsed.data;
    
    await addPacksToUser(username, count);
    return apiOk({ success: true });
  } catch (error: any) {
    console.error('[Pokemon] Add packs error:', error);
    return apiError(error.message, { status: 500, code: 'INTERNAL_ERROR' });
  }
}
