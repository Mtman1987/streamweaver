import { NextResponse } from 'next/server';
import { getNextMessageNumber } from '@/lib/message-counter';
import { apiError } from '@/lib/api-response';
import { z } from 'zod';

const counterNextSchema = z
  .object({
    channelId: z.string().trim().min(1).max(128).optional(),
  })
  .passthrough();

export async function POST(request: Request) {
  try {
    let channelId = 'default';
    
    // Try to get channelId from request body, but don't require it
    try {
      const parsed = counterNextSchema.safeParse(await request.json().catch(() => null));
      if (parsed.success && parsed.data.channelId) {
        channelId = parsed.data.channelId;
      }
    } catch {
      // If no JSON body or parsing fails, use default
    }
    
    const result = await getNextMessageNumber(channelId);
    console.log(`[Counter API] Generated message number: ${result.number}`);
    return NextResponse.json(result);
  } catch (error) {
    console.error('Error getting next message number:', error);
    return apiError('Failed to get message number', { status: 500, code: 'INTERNAL_ERROR' });
  }
}