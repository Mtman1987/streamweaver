import { NextRequest } from 'next/server';
import { apiError, apiOk } from '@/lib/api-response';
import { z } from 'zod';

const exportActionSchema = z.object({
  action: z.record(z.unknown()),
  description: z.string().trim().min(1).max(2000),
});

export async function POST(request: NextRequest) {
  try {
    const parsed = exportActionSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return apiError('Invalid request body', { status: 400, code: 'INVALID_BODY' });
    }

    const { action, description } = parsed.data;
    
    const content = ['# Shared StreamWeaver Action', '', `Description: ${description}`, '', '```json', JSON.stringify(action, null, 2), '```'].join('\n');
    return apiOk({ success: true, content });
  } catch (error: any) {
    console.error('Failed to export action:', error);
    return apiError('Failed to export action', { status: 500, code: 'INTERNAL_ERROR', details: { success: false } });
  }
}