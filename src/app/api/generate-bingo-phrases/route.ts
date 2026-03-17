import { NextRequest } from 'next/server';
import { apiOk } from '@/lib/api-response';
import { z } from 'zod';

const bingoRequestSchema = z.object({
  streamerName: z.string().trim().max(128).optional(),
});

export async function POST(req: NextRequest) {
  try {
    bingoRequestSchema.safeParse(await req.json().catch(() => null));
    
    // Use fallback phrases for now (AI generation can be added later)
    const fallbackPhrases = [
      'GG', 'Hype!', 'F in chat', 'Poggers', 'LUL',
      'First death', 'Epic win', 'Streamer laughs', 'Drinks water', 'Pet appears',
      'Raid incoming', 'New sub', 'FREE SPACE', 'Donation alert', 'New follower',
      'Lag spike', 'Chat spams emotes', 'Tells a story', 'Sings along', 'Dance break',
      'Game crashes', 'Viewer count doubles', 'Emote only mode', 'Inside joke', 'Gets emotional'
    ];
    
    return apiOk({ phrases: fallbackPhrases });
  } catch (error) {
    console.error('[Bingo API] Error:', error);
    
    const fallbackPhrases = [
      'GG', 'Hype!', 'F in chat', 'Poggers', 'LUL',
      'First death', 'Epic win', 'Streamer laughs', 'Drinks water', 'Pet appears',
      'Raid incoming', 'New sub', 'FREE SPACE', 'Donation alert', 'New follower',
      'Lag spike', 'Chat spams emotes', 'Tells a story', 'Sings along', 'Dance break',
      'Game crashes', 'Viewer count doubles', 'Emote only mode', 'Inside joke', 'Gets emotional'
    ];
    
    return apiOk({ phrases: fallbackPhrases });
  }
}
