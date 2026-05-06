import * as fs from 'fs/promises';
import { resolve } from 'path';
import { readUserConfigSync } from '@/lib/user-config';
import { tenantPath } from '@/lib/tenant';

export type PublicChatMessage = {
  type: 'user' | 'ai';
  username: string;
  message: string;
  timestamp: string;
};

function getPublicChatFilePath(tenantId?: string): string {
  if (tenantId) {
    return tenantPath(tenantId, 'data/public-chat.json');
  }
  const config = readUserConfigSync();
  const username = config.TWITCH_BROADCASTER_USERNAME || 'default';
  return resolve(process.cwd(), 'src', 'data', `public-chat-${username}.json`);
}

function isPublicChatMessage(value: any): value is PublicChatMessage {
  return (
    value &&
    (value.type === 'user' || value.type === 'ai') &&
    typeof value.username === 'string' &&
    typeof value.message === 'string' &&
    typeof value.timestamp === 'string'
  );
}

async function readAllUnsafe(tenantId?: string): Promise<PublicChatMessage[]> {
  try {
    const raw = await fs.readFile(getPublicChatFilePath(tenantId), 'utf-8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isPublicChatMessage);
  } catch {
    return [];
  }
}

export async function readPublicChatMessages(limit?: number, tenantId?: string): Promise<PublicChatMessage[]> {
  try {
    const all = await readAllUnsafe(tenantId);
    if (!limit || limit <= 0) return all;
    return all.slice(-limit);
  } catch {
    return [];
  }
}

export async function appendPublicChatMessages(
  newMessages: PublicChatMessage[],
  maxMessages = 100,
  tenantId?: string
): Promise<PublicChatMessage[]> {
  const safeMax = maxMessages > 0 ? maxMessages : 100;
  const filePath = getPublicChatFilePath(tenantId);

  const dir = resolve(filePath, '..');
  await fs.mkdir(dir, { recursive: true });

  const existing = await readPublicChatMessages(undefined, tenantId);
  const merged = [...existing, ...newMessages].filter(isPublicChatMessage);
  const trimmed = merged.length > safeMax ? merged.slice(-safeMax) : merged;

  await fs.writeFile(filePath, JSON.stringify(trimmed, null, 2));
  return trimmed;
}

export async function clearPublicChatMemory(tenantId?: string): Promise<void> {
  try {
    const filePath = getPublicChatFilePath(tenantId);
    const dir = resolve(filePath, '..');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(filePath, JSON.stringify([], null, 2));
    console.log('[Public Chat Store] Memory cleared due to content policy violation');
  } catch (error) {
    console.error('[Public Chat Store] Failed to clear memory:', error);
  }
}

export { getPublicChatFilePath };