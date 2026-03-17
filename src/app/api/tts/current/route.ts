import { NextRequest, NextResponse } from 'next/server';
import { apiError, apiOk } from '@/lib/api-response';
import { z } from 'zod';

const ttsCurrentSchema = z.object({
  audioUrl: z.string().min(1, 'audioUrl is required'),
});

type TtsState = {
  audioUrl: string | null;
  updatedAt: string | null;
};

function getTtsState(): TtsState {
  const g = globalThis as any;
  if (!g.__streamweaver_tts_state) {
    g.__streamweaver_tts_state = {
      audioUrl: null,
      updatedAt: null,
    } satisfies TtsState;
  }
  return g.__streamweaver_tts_state as TtsState;
}

export async function GET(request: NextRequest) {
  const state = getTtsState();
  const { searchParams } = new URL(request.url);

  // ?poll=1 returns only the timestamp (lightweight check)
  if (searchParams.get('poll')) {
    return apiOk({ updatedAt: state.updatedAt });
  }

  return apiOk(state as unknown as Record<string, unknown>);
}

export async function POST(request: NextRequest) {
  try {
    const parsed = ttsCurrentSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return apiError('audioUrl is required', { status: 400, code: 'INVALID_BODY' });
    }

    const { audioUrl } = parsed.data;

    const state = getTtsState();
    state.audioUrl = audioUrl;
    state.updatedAt = new Date().toISOString();

    console.log('[TTS Current] POST stored | audioUrl length:', audioUrl.length, '| updatedAt:', state.updatedAt);
    return apiOk({ success: true, updatedAt: state.updatedAt });
  } catch (error: any) {
    return apiError(error?.message || 'Failed to save tts audio', { status: 500, code: 'INTERNAL_ERROR' });
  }
}

