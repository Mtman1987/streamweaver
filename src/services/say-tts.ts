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
