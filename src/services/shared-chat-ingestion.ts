import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { tenantPath } from '../lib/tenant';
import { parseSharedChatEventV1, type SharedChatEventV1, type SharedChatPlatform } from '../contracts/shared-chat-event';

export const DEFAULT_SHARED_CHAT_REPLAY_LIMIT = 500;
export const DEFAULT_SHARED_CHAT_DEAD_LETTER_LIMIT = 200;

export type SharedChatDeadLetter = {
  id: string;
  tenantId: string;
  source: SharedChatPlatform | 'unknown';
  reason: string;
  receivedTimestamp: string;
  payload: unknown;
};

function replayPath(tenantId: string): string {
  return tenantPath(tenantId, 'data/shared-chat/replay.json');
}

function deadLetterPath(tenantId: string): string {
  return tenantPath(tenantId, 'data/shared-chat/dead-letter.json');
}

async function readJsonArray<T>(filePath: string): Promise<T[]> {
  try {
    const raw = await readFile(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error: any) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
}

async function writeJsonArray<T>(filePath: string, entries: T[]): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, JSON.stringify(entries, null, 2), 'utf-8');
  await rename(tempPath, filePath);
}

export async function recordSharedChatEvent(
  input: SharedChatEventV1,
  options: { maxReplayEvents?: number } = {},
): Promise<SharedChatEventV1> {
  const event = parseSharedChatEventV1(input);
  const maxReplayEvents = Math.max(1, options.maxReplayEvents ?? DEFAULT_SHARED_CHAT_REPLAY_LIMIT);
  const filePath = replayPath(event.tenantId);
  const existing = await readJsonArray<SharedChatEventV1>(filePath);
  const withoutDuplicate = existing.filter((entry) => entry.dedupeKey !== event.dedupeKey);
  const next = [...withoutDuplicate, event].slice(-maxReplayEvents);
  await writeJsonArray(filePath, next);
  return event;
}

export async function recordSharedChatDeadLetter(
  input: Omit<SharedChatDeadLetter, 'id' | 'receivedTimestamp'> & Partial<Pick<SharedChatDeadLetter, 'id' | 'receivedTimestamp'>>,
  options: { maxDeadLetters?: number } = {},
): Promise<SharedChatDeadLetter> {
  const tenantId = String(input.tenantId || '').trim();
  if (!tenantId) throw new Error('tenantId is required for shared chat dead-letter storage');
  const deadLetter: SharedChatDeadLetter = {
    id: input.id || `dl_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
    tenantId,
    source: input.source || 'unknown',
    reason: String(input.reason || 'unknown'),
    receivedTimestamp: input.receivedTimestamp || new Date().toISOString(),
    payload: input.payload,
  };
  const maxDeadLetters = Math.max(1, options.maxDeadLetters ?? DEFAULT_SHARED_CHAT_DEAD_LETTER_LIMIT);
  const filePath = deadLetterPath(tenantId);
  const existing = await readJsonArray<SharedChatDeadLetter>(filePath);
  const next = [...existing, deadLetter].slice(-maxDeadLetters);
  await writeJsonArray(filePath, next);
  return deadLetter;
}

export async function readSharedChatReplay(
  tenantId: string,
  options: { limit?: number } = {},
): Promise<SharedChatEventV1[]> {
  const cleanTenantId = String(tenantId || '').trim();
  if (!cleanTenantId) return [];
  const limit = Math.max(1, options.limit ?? DEFAULT_SHARED_CHAT_REPLAY_LIMIT);
  const entries = await readJsonArray<unknown>(replayPath(cleanTenantId));
  return entries
    .map((entry) => {
      try {
        return parseSharedChatEventV1(entry);
      } catch {
        return null;
      }
    })
    .filter((entry): entry is SharedChatEventV1 => Boolean(entry))
    .slice(-limit);
}

export async function readSharedChatDeadLetters(
  tenantId: string,
  options: { limit?: number } = {},
): Promise<SharedChatDeadLetter[]> {
  const cleanTenantId = String(tenantId || '').trim();
  if (!cleanTenantId) return [];
  const limit = Math.max(1, options.limit ?? DEFAULT_SHARED_CHAT_DEAD_LETTER_LIMIT);
  return (await readJsonArray<SharedChatDeadLetter>(deadLetterPath(cleanTenantId))).slice(-limit);
}
