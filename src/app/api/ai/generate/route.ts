import { NextRequest, NextResponse } from 'next/server';
import { generateAIResponse } from '@/services/ai-provider';
import { apiError, apiOk } from '@/lib/api-response';
import { z } from 'zod';

type Body = {
  prompt: string;
  temperature?: number;
  maxOutputTokens?: number;
};

const aiGenerateSchema = z.object({
  prompt: z.string().trim().min(1, 'Missing prompt').max(8000, 'Prompt too long'),
  temperature: z.number().min(0).max(2).optional(),
  maxOutputTokens: z.number().int().min(1).max(8192).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const parsed = aiGenerateSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return apiError('Missing prompt', { status: 400, code: 'INVALID_BODY' });
    }

    const { prompt } = parsed.data;

    console.log('[ai/generate] Request:', { promptLength: prompt.length });

    const text = await generateAIResponse(prompt);
    console.log('[ai/generate] Response generated', { responseLength: text.length });
    
    return apiOk({ text });
  } catch (error: any) {
    console.error('[ai/generate] Error:', error);
    return apiError(error.message || 'AI generate failed', { status: 500, code: 'INTERNAL_ERROR' });
  }
}
