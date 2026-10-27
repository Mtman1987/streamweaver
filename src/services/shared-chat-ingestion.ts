import { createHash, randomUUID } from 'node:crypto';
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
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      // Keep the original locally for recovery; a damaged replay must not
      // take the highlighter or subsequent chat ingestion offline.
      const digest = createHash('sha256').update(raw).digest('hex');
      try {
        await writeFile(`${filePath}.corrupt-${digest}.bak`, raw, { flag: 'wx', mode: 0o600 });
      } catch (backupError: any) {
        if (backupError?.code !== 'EEXIST') throw backupError;
      }
      return [];
    }
    return Array.isArray(parsed) ? parsed : [];
  } catch (error: any) {
    if (error?.code === 'ENOENT') return [];
    if (error instanceof SyntaxError) {
      const corruptPath = `${filePath}.corrupt-${Date.now()}`;
      try {
        await rename(filePath, corruptPath);
        console.warn('[SharedChat] Quarantined malformed JSON store so the live route can recover.');
      } catch (renameError: any) {
        if (renameError?.code !== 'ENOENT') {
          console.warn('[SharedChat] Malformed JSON store could not be quarantined:', renameError?.message || String(renameError));
        }
      }
      return [];
    }
    throw error;
  }
}

async function writeJsonArray<T>(filePath: string, entries: T[]): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tempPath, JSON.stringify(entries, null, 2), 'utf-8');
  await rename(tempPath, filePath);
}

const pendingWrites = new Map<string, Promise<unknown>>();

async function updateJsonArray<T>(
  filePath: string,
  update: (existing: T[]) => T[],
): Promise<void> {
  const previous = pendingWrites.get(filePath) ?? Promise.resolve();
  const pending = previous.catch(() => undefined).then(async () => {
    await mkdir(dirname(filePath), { recursive: true });
    // Next.js and the chat gateway both write replay. Serialize across
    // processes as well as concurrent requests in this process.
    const lockfile = require('proper-lockfile');
    const release = await lockfile.lock(filePath, {
      realpath: false,
      stale: 10_000,
      retries: { retries: 100, factor: 1, minTimeout: 20, maxTimeout: 20 },
    });
    try {
      await writeJsonArray(filePath, update(await readJsonArray<T>(filePath)));
    } finally {
      await release();
    }
  });
  pendingWrites.set(filePath, pending);
  try {
    await pending;
  } finally {
    if (pendingWrites.get(filePath) === pending) pendingWrites.delete(filePath);
  }
}

export async function recordSharedChatEvent(
  input: SharedChatEventV1,
  options: { maxReplayEvents?: number } = {},
): Promise<SharedChatEventV1> {
  const event = parseSharedChatEventV1(input);
  const maxReplayEvents = Math.max(1, options.maxReplayEvents ?? DEFAULT_SHARED_CHAT_REPLAY_LIMIT);
  const filePath = replayPath(event.tenantId);
  await updateJsonArray<SharedChatEventV1>(filePath, (existing) => {
    const withoutDuplicate = existing.filter((entry) => entry.dedupeKey !== event.dedupeKey);
    return [...withoutDuplicate, event].slice(-maxReplayEvents);
  });
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
  await updateJsonArray<SharedChatDeadLetter>(filePath, (existing) =>
    [...existing, deadLetter].slice(-maxDeadLetters),
  );
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
