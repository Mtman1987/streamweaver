import { NextRequest } from 'next/server';
import { apiError, apiOk } from '@/lib/api-response';
import { getTenantFromRequest } from '@/lib/tenant-context';
import { z } from 'zod';

const ttsCurrentSchema = z.object({
  audioUrl: z.string().min(1, 'audioUrl is required'),
});

type TtsQueueItem = {
  audioUrl: string;
  addedAt: string;
};

type TenantTtsState = {
  queue: TtsQueueItem[];
  lastServedAt: string | null;
};

type TtsStateMap = Record<string, TenantTtsState>;

function getTtsStateMap(): TtsStateMap {
  const g = globalThis as any;
  if (!g.__streamweaver_tts_queue_by_tenant) {
    g.__streamweaver_tts_queue_by_tenant = {};
  }
  return g.__streamweaver_tts_queue_by_tenant as TtsStateMap;
}

function getTenantKey(request: NextRequest): string {
  const session = getTenantFromRequest(request);
  const tenantFromQuery = request.nextUrl.searchParams.get('tenant');
  return session?.tenantId || tenantFromQuery || 'global';
}

function getTenantState(request: NextRequest): TenantTtsState {
  const tenantKey = getTenantKey(request);
  const map = getTtsStateMap();
  if (!map[tenantKey]) {
    map[tenantKey] = { queue: [], lastServedAt: null };
  }
  return map[tenantKey];
}

function isLocalRequest(request: NextRequest): boolean {
  const host = request.headers.get('host') || '';
  if (host.startsWith('127.0.0.1') || host.startsWith('localhost')) return true;
  const forwarded = request.headers.get('x-forwarded-for') || '';
  if (forwarded.startsWith('127.0.0.1') || forwarded === '::1') return true;
  if (request.nextUrl.searchParams.get('tenant')) return true;
  return false;
}

export async function GET(request: NextRequest) {
  const state = getTenantState(request);
  const { searchParams } = new URL(request.url);

  // ?poll=1 returns whether there's anything queued (lightweight check)
  if (searchParams.get('poll')) {
    const hasItems = state.queue.length > 0;
    return apiOk({ updatedAt: hasItems ? state.queue[0].addedAt : state.lastServedAt });
  }

  // ?next=1 pops the next item from the queue (player calls this when ready for next)
  if (searchParams.get('next')) {
    const item = state.queue.shift();
    if (item) {
      state.lastServedAt = item.addedAt;
      return apiOk({ audioUrl: item.audioUrl, updatedAt: item.addedAt, remaining: state.queue.length });
    }
    return apiOk({ audioUrl: null, updatedAt: state.lastServedAt, remaining: 0 });
  }

  // Default: peek at front of queue without removing (backward compat)
  if (state.queue.length > 0) {
    return apiOk({ audioUrl: state.queue[0].audioUrl, updatedAt: state.queue[0].addedAt });
  }
  return apiOk({ audioUrl: null, updatedAt: state.lastServedAt });
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
    const addedAt = new Date().toISOString();

    state.queue.push({ audioUrl, addedAt });

    // Cap queue at 20 to prevent memory issues
    if (state.queue.length > 20) {
      state.queue = state.queue.slice(-20);
    }

    console.log('[TTS Current] POST queued | queue size:', state.queue.length, '| addedAt:', addedAt);
    return apiOk({ success: true, updatedAt: addedAt, queueSize: state.queue.length });
  } catch (error: any) {
    return apiError(error?.message || 'Failed to queue tts audio', { status: 500, code: 'INTERNAL_ERROR' });
  }
}
