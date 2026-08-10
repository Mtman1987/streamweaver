import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';
import { globalPath } from '@/lib/tenant';

const MAX_TRACKED_MESSAGE_IDS = 2000;
const PERSISTED_DEDUPE_FILE = 'discord-handled-message-ids.json';
const PROCESS_STARTED_AT = Date.now();
const INITIAL_EVENT_GRACE_MS = 2 * 60 * 1000;

const globalState = global as typeof globalThis & {
  __streamweaverDiscordHandledMessageIds?: Set<string>;
  __streamweaverDiscordMessageWatermarks?: Map<string, string>;
};

function getHandledMessageIds(): Set<string> {
  if (!globalState.__streamweaverDiscordHandledMessageIds) {
    globalState.__streamweaverDiscordHandledMessageIds = new Set<string>();
  }
  return globalState.__streamweaverDiscordHandledMessageIds;
}

function getMessageWatermarks(): Map<string, string> {
  if (!globalState.__streamweaverDiscordMessageWatermarks) {
    globalState.__streamweaverDiscordMessageWatermarks = new Map<string, string>();
  }
  return globalState.__streamweaverDiscordMessageWatermarks;
}

function compareDiscordMessageIds(left: string, right: string): number {
  try {
    const leftId = BigInt(left);
    const rightId = BigInt(right);
    if (leftId === rightId) return 0;
    return leftId > rightId ? 1 : -1;
  } catch {
    if (left === right) return 0;
    return left > right ? 1 : -1;
  }
}

function normalizeMessageKey(messageId?: string | null, channelId?: string | null): string {
  const normalizedMessageId = String(messageId || '').trim();
  if (!normalizedMessageId) return '';
  const normalizedChannelId = String(channelId || '').trim();
  return normalizedChannelId ? `${normalizedChannelId}:${normalizedMessageId}` : normalizedMessageId;
}

export type DiscordMessageDedupeInput = {
  messageId?: string | null;
  channelId?: string | null;
  userId?: string | null;
  username?: string | null;
  content?: string | null;
  createdAt?: string | null;
};

function normalizeSignatureKey(input: DiscordMessageDedupeInput): string {
  const channelId = String(input.channelId || '').trim();
  const actor = String(input.userId || input.username || '').trim().toLowerCase();
  const content = String(input.content || '').trim().replace(/\s+/g, ' ');
  const createdAt = String(input.createdAt || '').trim();
  if (!channelId || !actor || !content || !createdAt) return '';
  return `sig:${channelId}:${actor}:${createdAt}:${content}`;
}

function trimHandledKeys(handled: Set<string>): void {
  if (handled.size <= MAX_TRACKED_MESSAGE_IDS) return;

  const overflow = handled.size - MAX_TRACKED_MESSAGE_IDS;
  let removed = 0;
  for (const existingKey of handled) {
    handled.delete(existingKey);
    removed += 1;
    if (removed >= overflow) break;
  }
}

function dedupeKeys(input: DiscordMessageDedupeInput): string[] {
  return [
    normalizeMessageKey(input.messageId, input.channelId),
    normalizeSignatureKey(input),
  ].filter(Boolean);
}

export function registerHandledDiscordMessage(inputOrMessageId?: DiscordMessageDedupeInput | string | null, channelId?: string | null): boolean {
  const input: DiscordMessageDedupeInput =
    typeof inputOrMessageId === 'object' && inputOrMessageId !== null
      ? inputOrMessageId
      : { messageId: inputOrMessageId, channelId };

  const keys = dedupeKeys(input);
  if (keys.length === 0) return true;

  const handled = getHandledMessageIds();
  for (const key of keys) {
    if (handled.has(key)) return false;
  }

  for (const key of keys) {
    handled.add(key);
  }
  trimHandledKeys(handled);
  return true;
}

function persistedDedupePath(): string {
  return globalPath(PERSISTED_DEDUPE_FILE);
}

let persistedStateLoad: Promise<void> | null = null;
let persistedWriteQueue: Promise<void> = Promise.resolve();

async function loadPersistedHandledMessageIds(): Promise<void> {
  if (!persistedStateLoad) {
    persistedStateLoad = (async () => {
      try {
        const parsed = JSON.parse(await fs.readFile(persistedDedupePath(), 'utf8'));
        const keys = Array.isArray(parsed?.keys) ? parsed.keys : [];
        const handled = getHandledMessageIds();
        for (const key of keys.slice(-MAX_TRACKED_MESSAGE_IDS)) {
          const normalized = String(key || '').trim();
          if (normalized) handled.add(normalized);
        }
        trimHandledKeys(handled);

        const watermarks = parsed?.watermarks && typeof parsed.watermarks === 'object'
          ? parsed.watermarks as Record<string, unknown>
          : {};
        const messageWatermarks = getMessageWatermarks();
        for (const [channelId, messageId] of Object.entries(watermarks)) {
          const normalizedChannelId = String(channelId || '').trim();
          const normalizedMessageId = String(messageId || '').trim();
          if (normalizedChannelId && normalizedMessageId) {
            messageWatermarks.set(normalizedChannelId, normalizedMessageId);
          }
        }
      } catch {
        // A missing or malformed state file starts with an empty dedupe set.
      }
    })();
  }
  await persistedStateLoad;
}

async function persistHandledMessageIds(): Promise<void> {
  const statePath = persistedDedupePath();
  const snapshot = Array.from(getHandledMessageIds()).slice(-MAX_TRACKED_MESSAGE_IDS);
  persistedWriteQueue = persistedWriteQueue
    .catch(() => {})
    .then(async () => {
      await fs.mkdir(dirname(statePath), { recursive: true });
      const tempPath = `${statePath}.tmp`;
      await fs.writeFile(tempPath, JSON.stringify({
        version: 2,
        keys: snapshot,
        watermarks: Object.fromEntries(getMessageWatermarks()),
        updatedAt: new Date().toISOString(),
      }, null, 2));
      await fs.rename(tempPath, statePath);
    });
  await persistedWriteQueue;
}

/**
 * Restart-safe ingress claim. The message is persisted before any response side
 * effect, so Discord/Kite/DSH retries cannot replay an old question after a
 * process restart. This covers both public channels and private DMs.
 */
export async function registerHandledDiscordMessagePersisted(
  input: DiscordMessageDedupeInput,
): Promise<boolean> {
  await loadPersistedHandledMessageIds();

  const channelId = String(input.channelId || '').trim();
  const messageId = String(input.messageId || '').trim();
  const watermarks = getMessageWatermarks();
  const watermark = channelId ? watermarks.get(channelId) : undefined;
  const createdAt = Date.parse(String(input.createdAt || ''));
  const staleEvent = channelId
    && messageId
    && Number.isFinite(createdAt)
    && createdAt < PROCESS_STARTED_AT - INITIAL_EVENT_GRACE_MS;
  if (staleEvent) {
    if (!watermark || compareDiscordMessageIds(messageId, watermark) > 0) {
      watermarks.set(channelId, messageId);
      try {
        await persistHandledMessageIds();
      } catch (error) {
        console.warn('[Discord Dedupe] Failed to seed stale-message watermark:', error);
      }
    }
    return false;
  }

  if (watermark && messageId && compareDiscordMessageIds(messageId, watermark) <= 0) {
    return false;
  }

  const firstSeen = registerHandledDiscordMessage(input);
  if (!firstSeen) return false;
  if (channelId && messageId) {
    watermarks.set(channelId, messageId);
  }
  try {
    await persistHandledMessageIds();
  } catch (error) {
    console.warn('[Discord Dedupe] Failed to persist handled message state:', error);
  }
  return true;
}
