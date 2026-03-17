import { NextRequest, NextResponse } from 'next/server';
import { adjustMessageCount } from '@/lib/ltm-store';
import { apiError, apiOk } from '@/lib/api-response';
import { z } from 'zod';

const ltmAdjustSchema = z.object({
  adjustment: z.number().finite(),
});

export async function POST(request: NextRequest) {
  try {
    const parsed = ltmAdjustSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return apiError('adjustment must be a number', { status: 400, code: 'INVALID_BODY' });
    }
    const { adjustment } = parsed.data;
    
    const newCount = await adjustMessageCount(adjustment);
    return apiOk({ messageCount: newCount });
  } catch (error) {
    console.error('[LTM Adjust] Error:', error);
    return apiError('Failed to adjust message count', { status: 500, code: 'INTERNAL_ERROR' });
  }
}