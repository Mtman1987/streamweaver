import * as fs from 'fs/promises';
import { resolve } from 'path';
import { readUserConfigSync } from '@/lib/user-config';

export type PublicChatMessage = {
  type: 'user' | 'ai';
  username: string;
  message: string;
  timestamp: string;
};

function getPublicChatFilePath(): string {
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

async function readAllUnsafe(): Promise<PublicChatMessage[]> {
  try {
    const raw = await fs.readFile(getPublicChatFilePath(), 'utf-8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isPublicChatMessage);
  } catch {
    return [];
  }
}

export async function readPublicChatMessages(limit?: number): Promise<PublicChatMessage[]> {
  try {
    const all = await readAllUnsafe();
    if (!limit || limit <= 0) return all;
    return all.slice(-limit);
  } catch {
    return [];
  }
}

export async function appendPublicChatMessages(
  newMessages: PublicChatMessage[],
  maxMessages = 100
): Promise<PublicChatMessage[]> {
  const safeMax = maxMessages > 0 ? maxMessages : 100;

  const existing = await readPublicChatMessages();
  const merged = [...existing, ...newMessages].filter(isPublicChatMessage);
  const trimmed = merged.length > safeMax ? merged.slice(-safeMax) : merged;

  await fs.writeFile(getPublicChatFilePath(), JSON.stringify(trimmed, null, 2));
  return trimmed;
}

export { getPublicChatFilePath };