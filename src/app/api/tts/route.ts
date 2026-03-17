import { NextRequest, NextResponse } from 'next/server';
import { generateTTS } from '@/services/tts-provider';
import { apiError, apiOk } from '@/lib/api-response';
import { z } from 'zod';

const ttsSchema = z.object({
  text: z.string().trim().min(1, 'Text is required').max(2000, 'Text too long'),
  voice: z.string().trim().min(1).max(128).optional(),
});

export async function POST(request: NextRequest) {
  try {
    const parsed = ttsSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      console.error('[TTS API] Invalid request body:', parsed.error.flatten());
      return apiError('Invalid request body', { status: 400, code: 'INVALID_BODY' });
    }

    const { text, voice } = parsed.data;
    console.log('[TTS API] Request:', { textLength: text.length, textPreview: text.slice(0, 80), voice: voice ?? '(default)' });

    const audioDataUri = await generateTTS(text, voice);
    console.log('[TTS API] Success, audioDataUri length:', audioDataUri.length);
    return apiOk({ audioDataUri });
  } catch (error: any) {
    console.error('[TTS API] Error:', error.message || error);
    return apiError(error.message || 'TTS failed', { status: 500, code: 'TTS_FAILED' });
  }
}
