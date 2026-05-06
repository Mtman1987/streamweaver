import { NextRequest } from 'next/server';
import { apiError, apiOk } from '@/lib/api-response';
import { getTenantFromRequest } from '@/lib/tenant-context';
import { z } from 'zod';

const ttsCurrentSchema = z.object({
  audioUrl: z.string().min(1, 'audioUrl is required'),
});

type TtsState = {
  audioUrl: string | null;
  updatedAt: string | null;
};

type TenantTtsState = Record<string, TtsState>;

function getTtsStateMap(): TenantTtsState {
  const g = globalThis as any;
  if (!g.__streamweaver_tts_state_by_tenant) {
    g.__streamweaver_tts_state_by_tenant = {};
  }
  return g.__streamweaver_tts_state_by_tenant as TenantTtsState;
}

function getTenantKey(request: NextRequest): string {
  const session = getTenantFromRequest(request);
  const tenantFromQuery = request.nextUrl.searchParams.get('tenant');
  return session?.tenantId || tenantFromQuery || 'global';
}

function getTenantState(request: NextRequest): TtsState {
  const tenantKey = getTenantKey(request);
  const map = getTtsStateMap();
  if (!map[tenantKey]) {
    map[tenantKey] = {
      audioUrl: null,
      updatedAt: null,
    };
  }
  return map[tenantKey];
}

function isLocalRequest(request: NextRequest): boolean {
  const host = request.headers.get('host') || '';
  return host.startsWith('127.0.0.1') || host.startsWith('localhost');
}

export async function GET(request: NextRequest) {
  const state = getTenantState(request);
  const { searchParams } = new URL(request.url);

  // ?poll=1 returns only the timestamp (lightweight check)
  if (searchParams.get('poll')) {
    return apiOk({ updatedAt: state.updatedAt });
  }

  return apiOk(state as unknown as Record<string, unknown>);
}

export async function POST(request: NextRequest) {
  try {
    const session = getTenantFromRequest(request);
    if (!session && !isLocalRequest(request)) {
      return apiError('Not authenticated', { status: 401, code: 'UNAUTHORIZED' });
    }

    const parsed = ttsCurrentSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return apiError('audioUrl is required', { status: 400, code: 'INVALID_BODY' });
    }

    const { audioUrl } = parsed.data;

    const state = getTenantState(request);
    state.audioUrl = audioUrl;
    state.updatedAt = new Date().toISOString();

    console.log('[TTS Current] POST stored | audioUrl length:', audioUrl.length, '| updatedAt:', state.updatedAt);
    return apiOk({ success: true, updatedAt: state.updatedAt });
  } catch (error: any) {
    return apiError(error?.message || 'Failed to save tts audio', { status: 500, code: 'INTERNAL_ERROR' });
  }
}
