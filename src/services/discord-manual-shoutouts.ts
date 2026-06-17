import { promises as fs } from 'fs';
import { resolve } from 'path';
import { globalPath } from '@/lib/tenant';
import { buildDiscordCommandShoutoutPayload } from './discord-command-shoutout';
import { deleteMessage, editDiscordMessage } from './discord-local';

type ManualShoutoutEntry = {
  id: string;
  channelId: string;
  messageId: string;
  twitchLogin: string;
  requesterName: string;
  targetName: string;
  tenantId?: string;
  createdAt: string;
  updatedAt: string;
};

const FILE_NAME = 'discord-manual-shoutouts.json';
const POLL_INTERVAL_MS = 2 * 60 * 1000;

let poller: ReturnType<typeof setInterval> | null = null;
let running = false;

function filePath(): string {
  return globalPath(FILE_NAME);
}

async function readEntries(): Promise<ManualShoutoutEntry[]> {
  try {
    const raw = await fs.readFile(filePath(), 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeEntries(entries: ManualShoutoutEntry[]): Promise<void> {
  const path = filePath();
  await fs.mkdir(resolve(path, '..'), { recursive: true });
  await fs.writeFile(path, JSON.stringify(entries, null, 2));
}

export async function registerManualShoutout(entry: Omit<ManualShoutoutEntry, 'id' | 'createdAt' | 'updatedAt'>): Promise<void> {
  const entries = await readEntries();
  const now = new Date().toISOString();
  const existingIndex = entries.findIndex((item) => item.messageId === entry.messageId || (item.channelId === entry.channelId && item.twitchLogin === entry.twitchLogin));
  const nextEntry: ManualShoutoutEntry = {
    id: existingIndex >= 0 ? entries[existingIndex].id : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: existingIndex >= 0 ? entries[existingIndex].createdAt : now,
    updatedAt: now,
    ...entry,
  };
  if (existingIndex >= 0) entries[existingIndex] = nextEntry;
  else entries.push(nextEntry);
  await writeEntries(entries);
}

async function processEntries(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const entries = await readEntries();
    if (!entries.length) return;

    const kept: ManualShoutoutEntry[] = [];
    for (const entry of entries) {
      try {
        const { payload, isLive } = await buildDiscordCommandShoutoutPayload({
          requesterName: entry.requesterName,
          targetName: entry.targetName,
          tenantId: entry.tenantId,
          allowGifGeneration: true,
        });

        if (!isLive) {
          await deleteMessage(entry.channelId, entry.messageId).catch(() => {});
          continue;
        }

        await editDiscordMessage(entry.channelId, entry.messageId, payload).catch(() => {});
        kept.push({
          ...entry,
          updatedAt: new Date().toISOString(),
        });
      } catch (error) {
        console.warn('[Discord Manual Shoutouts] Poll error:', error);
        kept.push(entry);
      }
    }

    await writeEntries(kept);
  } finally {
    running = false;
  }
}

export function startManualShoutoutPoller(): void {
  if (poller) return;
  poller = setInterval(() => {
    processEntries().catch((error) => console.warn('[Discord Manual Shoutouts] Background poll failed:', error));
  }, POLL_INTERVAL_MS);
  processEntries().catch((error) => console.warn('[Discord Manual Shoutouts] Initial poll failed:', error));
}
