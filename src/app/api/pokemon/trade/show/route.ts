import { NextRequest } from 'next/server';
import { getUserCollection, tradeCards } from '@/services/pokemon-tcg';
import { apiError, apiOk } from '@/lib/api-response';
import { z } from 'zod';

const tradeShowSchema = z.object({
  userA: z.string().trim().min(1),
  userB: z.string().trim().min(1),
  cardIdA: z.string().trim().min(1).optional(),
  cardIdB: z.string().trim().min(1).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const parsed = tradeShowSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return apiError('Both usernames required', { status: 400, code: 'INVALID_BODY' });
    }

    const { userA, userB, cardIdA, cardIdB } = parsed.data;
    
    // Get collections
    const collectionA = await getUserCollection(userA);
    const collectionB = await getUserCollection(userB);
    
    if (collectionA.cards.length === 0 || collectionB.cards.length === 0) {
      return apiError('One or both users have no cards', { status: 404, code: 'COLLECTION_EMPTY' });
    }
    
    // Pick random cards if not specified
    const finalCardIdA = cardIdA || collectionA.cards[Math.floor(Math.random() * collectionA.cards.length)].id;
    const finalCardIdB = cardIdB || collectionB.cards[Math.floor(Math.random() * collectionB.cards.length)].id;
    
    // Execute trade
    const result = await tradeCards(userA, userB, finalCardIdA, finalCardIdB);
    
    // Broadcast to WebSocket clients
    const broadcast = (global as any).broadcast;
    if (broadcast) {
      broadcast({
        type: 'pokemon-trade-show',
        userA,
        userB,
        cardA: result.cardA.imagePath,
        cardB: result.cardB.imagePath
      });
    }
    
    return apiOk({ 
      success: true, 
      cardA: result.cardA.name,
      cardB: result.cardB.name
    });
  } catch (error: any) {
    console.error('[Pokemon] Trade show error:', error);
    return apiError(error.message, { status: 500, code: 'INTERNAL_ERROR' });
  }
}
