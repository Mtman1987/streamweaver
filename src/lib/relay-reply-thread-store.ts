import { promises as fs } from 'fs';
import { dirname } from 'path';

import { globalPath, tenantPath } from '@/lib/tenant';
import type { WorldLoreCharacter } from '@/lib/world-lore-store';

export type RelayThreadPlatform = 'twitch' | 'discord';

export type RelayConversationTurn = {
  senderUsername: string;
  botName: string;
  message: string;
  createdAt: string;
};

export type RelayReplyThread = {
  id: string;
  conversationId: string;
  createdAt: string;
  expiresAt: string;
  recipientContextTenantId?: string;
  recipientBot: WorldLoreCharacter;
  recipientUsername?: string;
  recipientUserId?: string;
  delivery: {
    platform: RelayThreadPlatform;
    channelId: string;
    messageId?: string;
    isPrivate?: boolean;
  };
  history: RelayConversationTurn[];
  origin: {
    platform: RelayThreadPlatform;
    channelId: string;
    contextTenantId?: string;
    tenantId?: string;
    bot: WorldLoreCharacter;
    senderUsername: string;
    senderUserId?: string;
    messageId?: string;
    isPrivate?: boolean;
  };
};

const THREAD_FILE = 'data/relay-reply-threads.json';
const MAX_THREADS = 100;
export const RELAY_REPLY_TTL_MS = 10 * 60 * 1000;
const writeLocks = new Map<string, Promise<void>>();

function contextKey(tenantId?: string): string {
  return String(tenantId || '__community__').trim() || '__community__';
}

function threadFilePath(tenantId?: string): string {
  return tenantId
    ? tenantPath(tenantId, THREAD_FILE)
    : globalPath(THREAD_FILE);
}

function isActive(thread: RelayReplyThread, now = Date.now()): boolean {
  return Boolean(
    thread
    && thread.id
    && thread.delivery?.channelId
    && thread.origin?.channelId
    && new Date(thread.expiresAt).getTime() > now
  );
}

async function readThreads(tenantId?: string): Promise<RelayReplyThread[]> {
  try {
    const parsed = JSON.parse(await fs.readFile(threadFilePath(tenantId), 'utf8'));
    return Array.isArray(parsed) ? parsed.filter((entry) => isActive(entry)) : [];
  } catch {
    return [];
  }
}

async function writeThreads(tenantId: string | undefined, threads: RelayReplyThread[]): Promise<void> {
  const filePath = threadFilePath(tenantId);
  await fs.mkdir(dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temporaryPath, JSON.stringify(threads.slice(-MAX_THREADS), null, 2), 'utf8');
  await fs.rename(temporaryPath, filePath);
}

async function withThreadWriteLock<T>(
  tenantId: string | undefined,
  operation: () => Promise<T>,
): Promise<T> {
  const key = contextKey(tenantId);
  const previous = writeLocks.get(key) || Promise.resolve();
  const result = previous.then(operation);
  const settled = result.then(() => undefined, () => undefined);
  writeLocks.set(key, settled);
  try {
    return await result;
  } finally {
    if (writeLocks.get(key) === settled) writeLocks.delete(key);
  }
}

function normalizeIdentity(value: unknown): string {
  return String(value || '').trim().replace(/^@/, '').toLowerCase();
}

function isIntendedRecipient(thread: RelayReplyThread, userName: string, userId?: string): boolean {
  const intendedUserId = String(thread.recipientUserId || '').trim();
  const actualUserId = String(userId || '').trim();
  if (intendedUserId) return Boolean(actualUserId && intendedUserId === actualUserId);
  return Boolean(
    normalizeIdentity(thread.recipientUsername)
    && normalizeIdentity(thread.recipientUsername) === normalizeIdentity(userName)
  );
}

export async function recordRelayReplyThread(input: {
  recipientContextTenantId?: string;
  conversationId?: string;
  recipientBot: WorldLoreCharacter;
  recipientUsername?: string;
  recipientUserId?: string;
  deliveryPlatform: RelayThreadPlatform;
  deliveryChannelId: string;
  deliveryMessageId?: string;
  deliveryIsPrivate?: boolean;
  history?: RelayConversationTurn[];
  originPlatform: RelayThreadPlatform;
  originChannelId: string;
  originContextTenantId?: string;
  originTenantId?: string;
  originBot: WorldLoreCharacter;
  originSenderUsername: string;
  originSenderUserId?: string;
  originMessageId?: string;
  originIsPrivate?: boolean;
}): Promise<RelayReplyThread> {
  const now = Date.now();
  const thread: RelayReplyThread = {
    id: `relay-thread-${now}-${Math.random().toString(36).slice(2, 8)}`,
    conversationId: String(input.conversationId || '').trim() || `relay-conversation-${now}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + RELAY_REPLY_TTL_MS).toISOString(),
    recipientContextTenantId: String(input.recipientContextTenantId || '').trim() || undefined,
    recipientBot: input.recipientBot,
    recipientUsername: String(input.recipientUsername || '').trim() || undefined,
    recipientUserId: String(input.recipientUserId || '').trim() || undefined,
    delivery: {
      platform: input.deliveryPlatform,
      channelId: String(input.deliveryChannelId || '').trim(),
      messageId: String(input.deliveryMessageId || '').trim() || undefined,
      isPrivate: input.deliveryIsPrivate || undefined,
    },
    history: (input.history || []).slice(-12),
    origin: {
      platform: input.originPlatform,
      channelId: String(input.originChannelId || '').trim(),
      contextTenantId: String(input.originContextTenantId || '').trim() || undefined,
      tenantId: String(input.originTenantId || '').trim() || undefined,
      bot: input.originBot,
      senderUsername: String(input.originSenderUsername || '').trim(),
      senderUserId: String(input.originSenderUserId || '').trim() || undefined,
      messageId: String(input.originMessageId || '').trim() || undefined,
      isPrivate: input.originIsPrivate || undefined,
    },
  };

  if (
    !thread.delivery.channelId
    || !thread.origin.channelId
    || !thread.origin.senderUsername
    || (!thread.recipientUsername && !thread.recipientUserId)
  ) {
    throw new Error('Relay reply thread requires delivery, origin, sender, and recipient identity');
  }

  await withThreadWriteLock(input.recipientContextTenantId, async () => {
    const existing = await readThreads(input.recipientContextTenantId);
    await writeThreads(input.recipientContextTenantId, [...existing, thread]);
  });
  return thread;
}

export async function getLatestRelayReplyThread(input: {
  recipientContextTenantId?: string;
  platform: RelayThreadPlatform;
  channelId: string;
  recipientUsername: string;
  recipientUserId?: string;
}): Promise<RelayReplyThread | null> {
  const threads = await readThreads(input.recipientContextTenantId);
  return threads
    .filter((thread) =>
      thread.delivery.platform === input.platform
      && thread.delivery.channelId === input.channelId
      && isIntendedRecipient(thread, input.recipientUsername, input.recipientUserId)
    )
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0] || null;
}

export async function completeRelayReplyThread(
  recipientContextTenantId: string | undefined,
  threadId: string,
): Promise<void> {
  await withThreadWriteLock(recipientContextTenantId, async () => {
    const existing = await readThreads(recipientContextTenantId);
    const selected = existing.find((entry) => entry.id === threadId);
    await writeThreads(
      recipientContextTenantId,
      existing.filter((entry) =>
        entry.id !== threadId
        && (!selected?.conversationId || entry.conversationId !== selected.conversationId)
      ),
    );
  });
}
