import { NextRequest, NextResponse } from 'next/server';
import { generateShoutoutAI } from '@/ai/flows/shoutout-ai';
import { apiError, apiOk } from '@/lib/api-response';
import { z } from 'zod';

const shoutoutSchema = z.object({
  username: z.string().trim().min(1, 'Username is required').max(64),
  personality: z.string().trim().max(1000).optional(),
});

export async function POST(request: NextRequest) {
  const parsed = shoutoutSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return apiError('Username is required', { status: 400, code: 'INVALID_BODY' });
  }

  const { username, personality } = parsed.data;

  try {
    const result = await generateShoutoutAI({ username, personality });
    return apiOk(result as Record<string, unknown>);
  } catch (error: any) {
    console.error('Shoutout API error:', error);
    return apiOk({
      shoutout: `Go check out ${username} at https://twitch.tv/${username} - they are awesome!`,
    });
  }
}