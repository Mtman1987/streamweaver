import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { tenantPath } from '@/lib/tenant';

export type SharedChatOperatorState = {
  pinnedEventIds: string[];
  queuedEventIds: string[];
  featuredEventId: string | null;
  autoShow: boolean;
  autoAdvance: boolean;
  featureDurationSeconds: number;
  featureStyle: 'glass' | 'solid' | 'minimal';
  featuredAt: string | null;
  updatedAt: string;
};

const EMPTY_STATE: SharedChatOperatorState = {
  pinnedEventIds: [],
  queuedEventIds: [],
  featuredEventId: null,
  autoShow: false,
  autoAdvance: false,
  featureDurationSeconds: 15,
  featureStyle: 'glass',
  featuredAt: null,
  updatedAt: '',
};

function statePath(tenantId: string): string {
  return tenantPath(tenantId, 'data/shared-chat/operator-state.json');
}

function normalizeIds(value: unknown): string[] {
  return Array.isArray(value)
    ? Array.from(new Set(value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0))).slice(0, 100)
    : [];
}

export async function readSharedChatOperatorState(tenantId: string): Promise<SharedChatOperatorState> {
  try {
    const parsed = JSON.parse(await readFile(statePath(tenantId), 'utf-8')) as Partial<SharedChatOperatorState>;
    return {
      pinnedEventIds: normalizeIds(parsed.pinnedEventIds),
      queuedEventIds: normalizeIds(parsed.queuedEventIds),
      featuredEventId: typeof parsed.featuredEventId === 'string' && parsed.featuredEventId.trim()
        ? parsed.featuredEventId
        : null,
      autoShow: parsed.autoShow === true,
      autoAdvance: parsed.autoAdvance === true,
      featureDurationSeconds: Number.isFinite(parsed.featureDurationSeconds)
        ? Math.max(0, Math.min(300, Math.floor(parsed.featureDurationSeconds!)))
        : 15,
      featureStyle: ['glass', 'solid', 'minimal'].includes(String(parsed.featureStyle))
        ? parsed.featureStyle as SharedChatOperatorState['featureStyle']
        : 'glass',
      featuredAt: typeof parsed.featuredAt === 'string' ? parsed.featuredAt : null,
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : '',
    };
  } catch (error: any) {
    if (error?.code === 'ENOENT' || error instanceof SyntaxError) return { ...EMPTY_STATE };
    throw error;
  }
}

export async function writeSharedChatOperatorState(
  tenantId: string,
  state: Omit<SharedChatOperatorState, 'updatedAt'>,
): Promise<SharedChatOperatorState> {
  const next: SharedChatOperatorState = {
    pinnedEventIds: normalizeIds(state.pinnedEventIds),
    queuedEventIds: normalizeIds(state.queuedEventIds),
    featuredEventId: state.featuredEventId || null,
    autoShow: state.autoShow === true,
    autoAdvance: state.autoAdvance === true,
    featureDurationSeconds: Math.max(0, Math.min(300, Math.floor(state.featureDurationSeconds || 0))),
    featureStyle: state.featureStyle,
    featuredAt: state.featuredAt || null,
    updatedAt: new Date().toISOString(),
  };
  const filePath = statePath(tenantId);
  await mkdir(dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, JSON.stringify(next, null, 2), 'utf-8');
  await rename(tempPath, filePath);
  return next;
}
