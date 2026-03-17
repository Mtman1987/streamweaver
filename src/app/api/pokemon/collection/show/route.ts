import { NextRequest } from 'next/server';
import { getUserCollection } from '@/services/pokemon-tcg';
import { apiError, apiOk } from '@/lib/api-response';
import { z } from 'zod';

const collectionShowSchema = z.object({
  username: z.string().trim().min(1),
});

export async function POST(req: NextRequest) {
  try {
    const parsed = collectionShowSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return apiError('Username required', { status: 400, code: 'INVALID_BODY' });
    }

    const { username } = parsed.data;
    
    const collection = await getUserCollection(username);
    const cardUrls = collection.cards.map(c => c.imagePath);
    
    if (cardUrls.length === 0) {
      return apiError('No cards in collection', { status: 404, code: 'COLLECTION_EMPTY' });
    }
    
    // Broadcast to WebSocket clients
    const broadcast = (global as any).broadcast;
    if (broadcast) {
      broadcast({
        type: 'pokemon-collection-show',
        username,
        cards: cardUrls
      });
    }
    
    return apiOk({ success: true, cardCount: cardUrls.length });
  } catch (error: any) {
    console.error('[Pokemon] Collection show error:', error);
    return apiError(error.message, { status: 500, code: 'INTERNAL_ERROR' });
  }
}
