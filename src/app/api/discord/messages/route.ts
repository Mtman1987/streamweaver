import { NextRequest, NextResponse } from 'next/server';
import { apiError, apiOk } from '@/lib/api-response';
import { z } from 'zod';

const discordMessagesSchema = z.object({
  channelId: z.string().trim().min(1, 'Channel ID required').max(64, 'Channel ID invalid'),
  username: z.string().trim().min(1).max(128).optional().default(''),
  limit: z.coerce.number().int().min(1).max(100).optional().default(10),
});

export async function POST(request: NextRequest) {
  try {
    const parsed = discordMessagesSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return apiError('Invalid request body', { status: 400, code: 'INVALID_BODY' });
    }

    const { channelId, username, limit } = parsed.data;

    const { getChannelMessages } = require('@/services/discord');
    const messages = await getChannelMessages(channelId, limit * 2); // Get more to filter
    
    // Filter messages for the specific user and format for context
    const userId = username === 'mtman1987' ? 'U1' : 'U2';
    const userMessages = messages
      .filter((msg: any) => {
        const content = msg.content || '';
        return content.includes(`[AI][${userId}]`);
      })
      .slice(0, limit)
      .reverse() // Chronological order
      .map((msg: any) => {
        const content = msg.content || '';
        // Parse: [15][AI][U1] mtman1987: "message" or [16][AI][U1] Athena: "response"
        const match = content.match(/\[(\d+)\]\[AI\]\[U\d+\] (.+?): "(.+)"/);
        if (match) {
          const [, msgNum, author, text] = match;
          return { msgNum: parseInt(msgNum), author, content: text };
        }
        return null;
      })
      .filter(Boolean);

    return apiOk({ messages: userMessages });
  } catch (error) {
    console.error('Error fetching Discord messages:', error);
    return apiError('Failed to fetch messages', { status: 500, code: 'INTERNAL_ERROR' });
  }
}