import { promises as fs } from 'fs';
import { resolve } from 'path';
import { globalPath } from '@/lib/tenant';
import { deleteMessage, isDiscordApiError } from '@/services/discord-local';

type PendingDiscordCleanup = {
  id: string;
  createdAt: string;
  deleteAt: string;
  tenantId?: string;
  channelId: string;
  triggerMessageId?: string;
  replyMessageIds: string[];
  sourceUser?: string;
  botName?: string;
};

type DiscordCleanupInput = {
  tenantId?: string;
  channelId: string;
  triggerMessageId?: string;
  triggerMessage?: string;
  replyMessageIds: string[];
  replyMessages?: string[];
  sourceUser?: string;
  botName?: string;
};

type DiscordBotMessageHistoryEntry = PendingDiscordCleanup & {
  triggerMessage?: string;
  replyMessages: string[];
};

const CLEANUP_FILE = 'discord-message-cleanup.json';
const HISTORY_FILE = 'discord-bot-message-history.json';
const DEFAULT_DELETE_DELAY_MS = 10 * 60 * 1000;

const timers = new Map<string, ReturnType<typeof setTimeout>>();
let processing = false;

function cleanupEnabled(): boolean {
  return process.env.DISCORD_BOT_MESSAGE_CLEANUP_ENABLED !== 'false';
}

function cleanupFilePath(): string {
  return globalPath(CLEANUP_FILE);
}

function historyFilePath(): string {
  return globalPath(HISTORY_FILE);
}

export function getDiscordMessageCleanupDelayMs(): number {
  const configured = Number(process.env.DISCORD_BOT_MESSAGE_CLEANUP_MS || '');
  if (!Number.isFinite(configured) || configured <= 0) return DEFAULT_DELETE_DELAY_MS;
  return Math.max(1000, configured);
}

export function getDiscordMessageCleanupDeleteAt(now = Date.now()): string {
  return new Date(now + getDiscordMessageCleanupDelayMs()).toISOString();
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

async function readQueue(): Promise<PendingDiscordCleanup[]> {
  try {
    const parsed = JSON.parse(await fs.readFile(cleanupFilePath(), 'utf-8'));
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry) => typeof entry?.channelId === 'string' && Array.isArray(entry?.replyMessageIds));
  } catch {
    return [];
  }
}

async function writeQueue(queue: PendingDiscordCleanup[]): Promise<void> {
  const filePath = cleanupFilePath();
  await fs.mkdir(resolve(filePath, '..'), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(queue, null, 2));
}

async function appendHistory(entry: PendingDiscordCleanup, input: DiscordCleanupInput): Promise<void> {
  try {
    const filePath = historyFilePath();
    await fs.mkdir(resolve(filePath, '..'), { recursive: true });
    let existing: DiscordBotMessageHistoryEntry[] = [];
    try {
      const parsed = JSON.parse(await fs.readFile(filePath, 'utf-8'));
      if (Array.isArray(parsed)) existing = parsed;
    } catch {}
    const next: DiscordBotMessageHistoryEntry = {
      ...entry,
      triggerMessage: input.triggerMessage,
      replyMessages: input.replyMessages || [],
    };
    await fs.writeFile(filePath, JSON.stringify([...existing, next].slice(-500), null, 2));
  } catch (error) {
    console.warn('[Discord Cleanup] Message history persist failed:', error);
  }
}

function entryKey(entry: PendingDiscordCleanup): string {
  return `${entry.channelId}:${entry.triggerMessageId || entry.id}`;
}

function scheduleEntry(entry: PendingDiscordCleanup): void {
  const key = entryKey(entry);
  const existing = timers.get(key);
  if (existing) clearTimeout(existing);
  const delay = Math.max(0, new Date(entry.deleteAt).getTime() - Date.now());
  timers.set(key, setTimeout(() => {
    timers.delete(key);
    processDueDiscordMessageCleanups().catch((error) => console.error('[Discord Cleanup] Failed to process due cleanup:', error));
  }, delay));
}

export async function recordDiscordMessageCleanup(input: DiscordCleanupInput): Promise<string | null> {
  if (!cleanupEnabled()) return null;
  const replyMessageIds = unique(input.replyMessageIds);
  const triggerMessageId = input.triggerMessageId?.trim();
  if (!input.channelId || (!triggerMessageId && replyMessageIds.length === 0)) return null;

  const now = new Date();
  const deleteAt = getDiscordMessageCleanupDeleteAt(now.getTime());
  const queue = await readQueue();
  const existing = triggerMessageId
    ? queue.find((entry) => entry.channelId === input.channelId && entry.triggerMessageId === triggerMessageId)
    : undefined;

  const entry: PendingDiscordCleanup = existing ? {
    ...existing,
    replyMessageIds: unique([...existing.replyMessageIds, ...replyMessageIds]),
    botName: input.botName || existing.botName,
  } : {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: now.toISOString(),
    deleteAt,
    tenantId: input.tenantId,
    channelId: input.channelId,
    triggerMessageId,
    replyMessageIds,
    sourceUser: input.sourceUser,
    botName: input.botName,
  };

  const next = existing
    ? queue.map((item) => item.id === existing.id ? entry : item)
    : [...queue, entry];
  await writeQueue(next.slice(-250));
  await appendHistory(entry, input);
  scheduleEntry(entry);
  return entry.deleteAt;
}

export async function processDueDiscordMessageCleanups(): Promise<void> {
  if (!cleanupEnabled() || processing) return;
  processing = true;
  try {
    const now = Date.now();
    const queue = await readQueue();
    const due = queue.filter((entry) => new Date(entry.deleteAt).getTime() <= now);
    const pending = queue.filter((entry) => new Date(entry.deleteAt).getTime() > now);

    for (const entry of due) {
      const messageIds = unique([
        entry.triggerMessageId || '',
        ...entry.replyMessageIds,
      ]);
      for (const messageId of messageIds) {
        try {
          await deleteMessage(entry.channelId, messageId);
        } catch (error) {
          if (isDiscordApiError(error) && error.status === 404) {
            console.log(`[Discord Cleanup] Message already absent: ${JSON.stringify({
              channelId: entry.channelId,
              messageId,
              status: error.status,
            })}`);
            continue;
          }
          const detail = {
            channelId: entry.channelId,
            messageId,
            status: isDiscordApiError(error) ? error.status : undefined,
            error: error instanceof Error ? error.message : String(error),
          };
          // Keep the complete failure on one line so Fly's log monitor can
          // classify the actual Discord status instead of only seeing "{".
          console.warn(`[Discord Cleanup] Message delete failed: ${JSON.stringify(detail)}`);
        }
      }
    }

    await writeQueue(pending);
    for (const entry of pending) scheduleEntry(entry);
  } finally {
    processing = false;
  }
}
