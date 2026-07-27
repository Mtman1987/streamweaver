import { NextRequest } from 'next/server';
import { apiError, apiOk } from '@/lib/api-response';
import { getTenantFromRequest } from '@/lib/tenant-context';
import { hasInternalServiceAccess, hasMountainViewBridgeAccess } from '@/lib/internal-service-auth';
import { globalPath, tenantPath } from '@/lib/tenant';
import { mkdir, readFile, rename, writeFile } from 'fs/promises';
import path from 'path';
import { z } from 'zod';
import { touchTtsConsumer } from '@/services/tts-consumer-presence';

const ttsCurrentSchema = z.object({
  audioUrl: z.string().min(1, 'audioUrl is required'),
});

type TtsQueueItem = {
  cursor: string;
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

function getTtsLoadMap(): Record<string, Promise<TenantTtsState>> {
  const g = globalThis as any;
  if (!g.__streamweaver_tts_load_by_tenant) g.__streamweaver_tts_load_by_tenant = {};
  return g.__streamweaver_tts_load_by_tenant as Record<string, Promise<TenantTtsState>>;
}

function stateFile(tenantKey: string) {
  return tenantKey === 'global'
    ? globalPath('tts-current-state.json')
    : tenantPath(tenantKey, 'data/tts-current-state.json');
}

async function loadTenantState(tenantKey: string): Promise<TenantTtsState> {
  const map = getTtsStateMap();
  if (map[tenantKey]) return map[tenantKey];
  const loads = getTtsLoadMap();
  if (!loads[tenantKey]) {
    loads[tenantKey] = (async () => {
      try {
        const parsed = JSON.parse(await readFile(stateFile(tenantKey), 'utf8')) as TenantTtsState;
        map[tenantKey] = {
          queue: Array.isArray(parsed?.queue) ? parsed.queue.slice(-20) : [],
          lastServedAt: parsed?.lastServedAt || null,
        };
      } catch {
        map[tenantKey] = { queue: [], lastServedAt: null };
      }
      return map[tenantKey];
    })();
  }
  return loads[tenantKey];
}

async function persistTenantState(tenantKey: string, state: TenantTtsState) {
  const file = stateFile(tenantKey);
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp.${process.pid}.${crypto.randomUUID()}`;
  await writeFile(temporary, JSON.stringify(state), 'utf8');
  await rename(temporary, file);
}

function getTenantKey(request: NextRequest): string {
  const session = getTenantFromRequest(request);
  const tenantFromQuery = request.nextUrl.searchParams.get('tenant') || request.nextUrl.searchParams.get('tenantId');
  return session?.tenantId || tenantFromQuery || 'global';
}

async function getTenantState(request: NextRequest): Promise<TenantTtsState> {
  const tenantKey = getTenantKey(request);
  return loadTenantState(tenantKey);
}

export async function GET(request: NextRequest) {
  const tenantKey = getTenantKey(request);
  if (tenantKey !== 'global') {
    // Polling this queue is stronger evidence of a real OBS/browser consumer
    // than a timer heartbeat, which OBS can throttle in background scenes.
    touchTtsConsumer(tenantKey, 'overlay');
  }
  const state = await getTenantState(request);
  const { searchParams } = new URL(request.url);

  // ?poll=1 returns whether there's anything queued (lightweight check)
  if (searchParams.get('poll')) {
    const hasItems = state.queue.length > 0;
    return apiOk({ updatedAt: hasItems ? state.queue[0].addedAt : state.lastServedAt });
  }

  if (searchParams.get('latest') === '1') {
    const latest = state.queue[state.queue.length - 1];
    return apiOk({
      audioUrl: null,
      updatedAt: latest?.addedAt || state.lastServedAt,
      cursor: latest?.cursor || null,
      remaining: 0,
    });
  }

  // Public overlay reads are cursor-based and non-destructive. One player must not
  // be able to consume audio before another player for the same tenant receives it.
  if (searchParams.get('next')) {
    const after = searchParams.get('after');
    const afterIndex = after ? state.queue.findIndex((entry) => entry.cursor === after) : -1;
    const itemIndex = afterIndex >= 0 ? afterIndex + 1 : 0;
    const item = state.queue[itemIndex];
    if (item) {
      return apiOk({
        audioUrl: item.audioUrl,
        updatedAt: item.addedAt,
        cursor: item.cursor,
        remaining: Math.max(0, state.queue.length - itemIndex - 1),
      });
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
    if (!session && !hasInternalServiceAccess(request) && !hasMountainViewBridgeAccess(request)) {
      return apiError('Not authenticated', { status: 401, code: 'UNAUTHORIZED' });
    }
    if (getTenantKey(request) === 'global') {
      return apiError('Tenant context required', { status: 400, code: 'TENANT_REQUIRED' });
    }

    const parsed = ttsCurrentSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return apiError('audioUrl is required', { status: 400, code: 'INVALID_BODY' });
    }

    const { audioUrl } = parsed.data;
    const tenantKey = getTenantKey(request);
    const state = await getTenantState(request);
    const addedAt = new Date().toISOString();

    const cursor = crypto.randomUUID();
    state.queue.push({ cursor, audioUrl, addedAt });

    // Cap queue at 20 to prevent memory issues
    if (state.queue.length > 20) {
      state.queue = state.queue.slice(-20);
    }
    await persistTenantState(tenantKey, state);

    console.log('[TTS Current] POST queued | queue size:', state.queue.length, '| addedAt:', addedAt);
    return apiOk({ success: true, updatedAt: addedAt, cursor, queueSize: state.queue.length });
  } catch (error: any) {
    return apiError(error?.message || 'Failed to queue tts audio', { status: 500, code: 'INTERNAL_ERROR' });
  }
}
