import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { tenantPath } from '@/lib/tenant';

export type SharedChatSavedFilter = {
  id: string;
  name: string;
  platform: string;
  query: string;
};

export type SharedChatUserState = {
  lastReadEventId: string | null;
  savedFilters: SharedChatSavedFilter[];
  updatedAt: string;
};

type SharedChatUserStateFile = Record<string, SharedChatUserState>;

function statePath(tenantId: string): string {
  return tenantPath(tenantId, 'data/shared-chat/user-state.json');
}

function userKey(username: string): string {
  return String(username || '').trim().toLowerCase().replace(/[^a-z0-9._-]/g, '_').slice(0, 100) || 'unknown';
}

function cleanFilter(value: unknown): SharedChatSavedFilter | null {
  if (!value || typeof value !== 'object') return null;
  const input = value as Partial<SharedChatSavedFilter>;
  const id = String(input.id || '').trim().slice(0, 80);
  const name = String(input.name || '').trim().slice(0, 80);
  if (!id || !name) return null;
  return {
    id,
    name,
    platform: String(input.platform || 'all').trim().slice(0, 40) || 'all',
    query: String(input.query || '').trim().slice(0, 200),
  };
}

async function readFileState(tenantId: string): Promise<SharedChatUserStateFile> {
  try {
    const parsed = JSON.parse(await readFile(statePath(tenantId), 'utf-8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (error: any) {
    if (error?.code === 'ENOENT' || error instanceof SyntaxError) return {};
    throw error;
  }
}

export async function readSharedChatUserState(tenantId: string, username: string): Promise<SharedChatUserState> {
  const entry = (await readFileState(tenantId))[userKey(username)];
  return {
    lastReadEventId: typeof entry?.lastReadEventId === 'string' ? entry.lastReadEventId : null,
    savedFilters: Array.isArray(entry?.savedFilters)
      ? entry.savedFilters.map(cleanFilter).filter((filter): filter is SharedChatSavedFilter => Boolean(filter)).slice(0, 20)
      : [],
    updatedAt: typeof entry?.updatedAt === 'string' ? entry.updatedAt : '',
  };
}

export async function writeSharedChatUserState(
  tenantId: string,
  username: string,
  state: Omit<SharedChatUserState, 'updatedAt'>,
): Promise<SharedChatUserState> {
  const existing = await readFileState(tenantId);
  const next: SharedChatUserState = {
    lastReadEventId: state.lastReadEventId || null,
    savedFilters: state.savedFilters.map(cleanFilter).filter((filter): filter is SharedChatSavedFilter => Boolean(filter)).slice(0, 20),
    updatedAt: new Date().toISOString(),
  };
  existing[userKey(username)] = next;
  const filePath = statePath(tenantId);
  await mkdir(dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, JSON.stringify(existing, null, 2), 'utf-8');
  await rename(tempPath, filePath);
  return next;
}
