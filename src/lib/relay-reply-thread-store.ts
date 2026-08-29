import { promises as fs } from 'fs';
import { resolve } from 'path';

import { tenantPath } from '@/lib/tenant';
import type { WorldLoreCharacter } from '@/lib/world-lore-store';

export type RelayThreadPlatform = 'twitch' | 'discord';

export type RelayReplyThread = {
  id: string;
  createdAt: string;
  expiresAt: string;
  recipientTenantId: string;
  recipientBot: WorldLoreCharacter;
  recipientUsername?: string;
  recipientUserId?: string;
  origin: {
    platform: RelayThreadPlatform;
    channelId: string;
    tenantId?: string;
    bot: WorldLoreCharacter;
    senderUsername: string;
    senderUserId?: string;
  };
};

const THREAD_FILE = 'data/relay-reply-threads.json';
const MAX_THREADS = 50;
const THREAD_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const writeLocks = new Map<string, Promise<void>>();

function threadFilePath(tenantId: string): string {
  if (!tenantId) throw new Error('Relay reply threads require a recipient tenant');
  return tenantPath(tenantId, THREAD_FILE);
}

function isActive(thread: RelayReplyThread, now = Date.now()): boolean {
  return Boolean(
    thread
    && thread.id
    && thread.origin?.channelId
    && new Date(thread.expiresAt).getTime() > now
  );
}

async function readThreads(tenantId: string): Promise<RelayReplyThread[]> {
  try {
    const parsed = JSON.parse(await fs.readFile(threadFilePath(tenantId), 'utf8'));
    return Array.isArray(parsed) ? parsed.filter((entry) => isActive(entry)) : [];
  } catch {
    return [];
  }
}

async function writeThreads(tenantId: string, threads: RelayReplyThread[]): Promise<void> {
  const filePath = threadFilePath(tenantId);
  await fs.mkdir(resolve(filePath, '..'), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(filePath + '.pending', JSON.stringify(threads.slice(-MAX_THREADS), null, 2)).catch(() => {});
  await fs.rename(filePath + '.pending', temporaryPath).catch(async () => {
    await fs.writeFile(temporaryPath, JSON.stringify(threads.slice(-MAX_THREADS), null, 2));
  });
  await fs.rename(temporaryPath, filePath);
}

async function withThreadWriteLock<T>(tenantId: string, operation: () => Promise<T>): Promise<T> {
  const previous = writeLocks.get(tenantId) || Promise.resolve();
  let resolveResult!: (value: T) => void;
  let rejectResult!: (reason?: unknown) => void;
  const result = new Promise<T>((resolveValue, rejectValue) => {
    resolveResult = resolveValue;
    rejectResult = rejectValue;
  });
  const next = previous.then(async () => {
    try {
      resolveResult(await operation());
    } catch (error) {
      rejectResult(error);
    }
  });
  writeLocks.set(tenantId, next);
  try {
    return await result;
  } finally {
    if (writeLocks.get(tenantId) === next) writeLocks.delete(tenantId);
  }
}

export async function recordRelayReplyThread(input: {
  recipientTenantId: string;
  recipientBot: WorldLoreCharacter;
  recipientUsername?: string;
  recipientUserId?: string;
  originPlatform: RelayThreadPlatform;
  originChannelId: string;
  originTenantId?: string;
  originBot: WorldLoreCharacter;
  originSenderUsername: string;
  originSenderUserId?: string;
}): Promise<RelayReplyThread> {
  const now = Date.now();
  const thread: RelayReplyThread = {
    id: `relay-thread-${now}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + THREAD_TTL_MS).toISOString(),
    recipientTenantId: input.recipientTenantId,
    recipientBot: input.recipientBot,
    recipientUsername: String(input.recipientUsername || '').trim() || undefined,
    recipientUserId: String(input.recipientUserId || '').trim() || undefined,
    origin: {
      platform: input.originPlatform,
      channelId: String(input.originChannelId || '').trim(),
      tenantId: String(input.originTenantId || '').trim() || undefined,
      bot: input.originBot,
      senderUsername: String(input.originSenderUsername || '').trim(),
      senderUserId: String(input.originSenderUserId || '').trim() || undefined,
    },
  };

  if (!thread.origin.channelId || !thread.origin.senderUsername) {
    throw new Error('Relay reply thread requires an origin channel and sender');
  }

  await withThreadWriteLock(input.recipientTenantId, async () => {
    const existing = await readThreads(input.recipientTenantId);
    await writeThreads(input.recipientTenantId, [...existing, thread]);
  });
  return thread;
}

export async function getLatestRelayReplyThread(recipientTenantId: string): Promise<RelayReplyThread | null> {
  const threads = await readThreads(recipientTenantId);
  return threads.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0] || null;
}

export async function completeRelayReplyThread(recipientTenantId: string, threadId: string): Promise<void> {
  await withThreadWriteLock(recipientTenantId, async () => {
    const existing = await readThreads(recipientTenantId);
    await writeThreads(recipientTenantId, existing.filter((entry) => entry.id !== threadId));
  });
}
