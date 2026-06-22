import { promises as fs } from 'fs';
import { resolve } from 'path';
import { globalPath } from '@/lib/tenant';

export type DiscordLastSeenEntry = {
  userId?: string;
  username?: string;
  displayName?: string;
  guildId?: string;
  guildName?: string;
  channelId: string;
  channelName?: string;
  messageId?: string;
  tenantId?: string;
  lastSeenAt: string;
};

const LAST_SEEN_FILE = 'discord-last-seen.json';
const MAX_LAST_SEEN_ENTRIES = 1000;

function filePath(): string {
  return globalPath(LAST_SEEN_FILE);
}

function normalizeKey(value: unknown): string {
  return String(value || '')
    .trim()
    .replace(/^@/, '')
    .toLowerCase()
    .replace(/[^a-z0-9_./-]+/g, '');
}

async function readState(): Promise<Record<string, DiscordLastSeenEntry>> {
  try {
    const parsed = JSON.parse(await fs.readFile(filePath(), 'utf-8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

async function writeState(state: Record<string, DiscordLastSeenEntry>): Promise<void> {
  const entries = Object.entries(state)
    .sort((a, b) => new Date(b[1].lastSeenAt).getTime() - new Date(a[1].lastSeenAt).getTime())
    .slice(0, MAX_LAST_SEEN_ENTRIES);
  const path = filePath();
  await fs.mkdir(resolve(path, '..'), { recursive: true });
  await fs.writeFile(path, JSON.stringify(Object.fromEntries(entries), null, 2));
}

function entryKeys(entry: DiscordLastSeenEntry): string[] {
  return Array.from(new Set([
    entry.userId ? `id:${entry.userId}` : '',
    entry.username ? `name:${normalizeKey(entry.username)}` : '',
    entry.displayName ? `name:${normalizeKey(entry.displayName)}` : '',
  ].filter(Boolean)));
}

export async function recordDiscordLastSeen(input: {
  userId?: string;
  username?: string;
  displayName?: string;
  guildId?: string;
  guildName?: string;
  channelId?: string;
  channelName?: string;
  messageId?: string;
  tenantId?: string;
  createdAt?: string;
}): Promise<void> {
  const channelId = String(input.channelId || '').trim();
  if (!channelId) return;
  const entry: DiscordLastSeenEntry = {
    userId: String(input.userId || '').trim() || undefined,
    username: String(input.username || '').trim() || undefined,
    displayName: String(input.displayName || '').trim() || undefined,
    guildId: String(input.guildId || '').trim() || undefined,
    guildName: String(input.guildName || '').trim() || undefined,
    channelId,
    channelName: String(input.channelName || '').trim() || undefined,
    messageId: String(input.messageId || '').trim() || undefined,
    tenantId: String(input.tenantId || '').trim() || undefined,
    lastSeenAt: input.createdAt || new Date().toISOString(),
  };
  const keys = entryKeys(entry);
  if (!keys.length) return;
  const state = await readState();
  for (const key of keys) state[key] = entry;
  await writeState(state);
}

export async function findDiscordLastSeenForNames(names: string[]): Promise<DiscordLastSeenEntry | null> {
  const state = await readState();
  const keys = names.map((name) => `name:${normalizeKey(name)}`).filter((key) => key !== 'name:');
  const direct = keys
    .map((key) => state[key])
    .filter(Boolean)
    .sort((a, b) => new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime())[0];
  if (direct) return direct;

  const wanted = new Set(keys.map((key) => key.slice(5)));
  const scanned = Object.values(state)
    .filter((entry) => wanted.has(normalizeKey(entry.username)) || wanted.has(normalizeKey(entry.displayName)))
    .sort((a, b) => new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime())[0];
  return scanned || null;
}
