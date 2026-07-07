import { readFile, writeFile, mkdir } from 'fs/promises';

export const SAY_USERS_FILE_PATH = 'data/runtime/say-users.json';

export type SayState = 'on' | 'off';

export async function readSayUsers(): Promise<Set<string>> {
  try {
    const parsed = JSON.parse(await readFile(SAY_USERS_FILE_PATH, 'utf-8'));
    if (Array.isArray(parsed)) {
      return new Set(parsed.map((entry) => String(entry || '').trim()).filter(Boolean));
    }
  } catch {
    // Missing or invalid state means nobody is enrolled yet.
  }
  return new Set();
}

export async function writeSayUsers(users: Set<string>): Promise<void> {
  await mkdir('data/runtime', { recursive: true });
  await writeFile(SAY_USERS_FILE_PATH, JSON.stringify(Array.from(users).sort()));
}

export function normalizeSayChannel(channelId: unknown): string {
  return String(channelId || '').trim().replace(/^#/, '').toLowerCase();
}

export function normalizeSayUser(user: unknown): string {
  return String(user || '').trim().replace(/^@/, '').toLowerCase();
}

export function sayUserKey(user: unknown, channelId: unknown): string {
  return `${normalizeSayUser(user)}:${normalizeSayChannel(channelId)}`;
}

export function sayAllKey(channelId: unknown): string {
  return `all:${normalizeSayChannel(channelId)}`;
}

export function resolveSayStreamKey(tenantId: unknown, platform?: 'discord' | 'twitch', channelId?: unknown): string {
  const normalizedTenant = String(tenantId || '').trim();
  if (normalizedTenant) return normalizedTenant;

  const normalizedPlatform = String(platform || '').trim().toLowerCase();
  const normalizedChannel = normalizeSayChannel(channelId);
  if (normalizedPlatform && normalizedChannel) return `${normalizedPlatform}:${normalizedChannel}`;

  return 'global';
}

export function buildSayPlayerUrl(tenantId?: unknown, platform?: 'discord' | 'twitch', channelId?: unknown): string {
  const streamKey = resolveSayStreamKey(tenantId, platform, channelId);
  const suffix = streamKey !== 'global' ? `?tenantId=${encodeURIComponent(streamKey)}` : '';
  return `https://streamweaver-new.fly.dev/say-player${suffix}`;
}

export function cleanSayTextForSpeech(text: unknown): string {
  return String(text || '')
    .replace(/https?:\/\/\S+|www\.\S+/gi, ' ')
    .replace(/\p{Extended_Pictographic}/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isSayTextSpeakable(text: unknown): boolean {
  const cleaned = cleanSayTextForSpeech(text);
  if (!cleaned) return false;
  if (!/[a-z0-9]/i.test(cleaned)) return false;
  if (/^shout\s*out\s*:/i.test(cleaned)) return false;
  if (/\bgo\s+check\s+out\b/i.test(cleaned)) return false;
  return true;
}

export function parseSayState(value: unknown): SayState | null {
  const normalized = String(value || '').trim().toLowerCase();
  if (['on', 'yes', 'true', 'enable', 'enabled'].includes(normalized)) return 'on';
  if (['off', 'no', 'false', 'disable', 'disabled'].includes(normalized)) return 'off';
  return null;
}

export function applySayState(users: Set<string>, key: string, requestedState: SayState | null): SayState {
  const nextState = requestedState || (users.has(key) ? 'off' : 'on');
  if (nextState === 'on') users.add(key);
  else users.delete(key);
  return nextState;
}

export function isSayEnabled(users: Set<string>, user: unknown, channelId: unknown): boolean {
  return users.has(sayAllKey(channelId)) || users.has(sayUserKey(user, channelId));
}

export function hasSayEnabledInChannel(users: Set<string>, channelId: unknown): boolean {
  const channel = normalizeSayChannel(channelId);
  if (!channel) return false;
  if (users.has(sayAllKey(channel))) return true;
  for (const key of users) {
    if (key.endsWith(`:${channel}`)) return true;
  }
  return false;
}
