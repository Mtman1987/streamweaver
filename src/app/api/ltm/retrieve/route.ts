import { NextRequest, NextResponse } from 'next/server';
import { getLTMContent } from '@/lib/ltm-store';
import { apiError, apiOk } from '@/lib/api-response';
import { z } from 'zod';

type RequestBody = {
  title: string;
};

const ltmRetrieveSchema = z.object({
  title: z.string().trim().min(1, 'Missing title').max(200),
});

export async function POST(request: NextRequest) {
  try {
    const parsed = ltmRetrieveSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return apiError('Missing title', { status: 400, code: 'INVALID_BODY' });
    }
    const { title } = parsed.data;
    
    const content = await getLTMContent(title);
    
    if (content) {
      return apiOk({ 
        success: true, 
        title,
        content 
      });
    }
    
    return apiError('Memory not found', { status: 404, code: 'NOT_FOUND', details: { success: false } });
  } catch (error) {
    console.error('[LTM Retrieve API] Error:', error);
    return apiError('Failed to retrieve memory', { status: 500, code: 'INTERNAL_ERROR' });
  }
}