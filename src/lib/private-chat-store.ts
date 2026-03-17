import * as fs from 'fs/promises';
import { resolve } from 'path';
import { readUserConfigSync } from '@/lib/user-config';

export type PrivateChatMessage = {
  type: 'user' | 'ai';
  username: string;
  message: string;
  timestamp: string;
};

function getPrivateChatFilePath(): string {
  const config = readUserConfigSync();
  const username = config.TWITCH_BROADCASTER_USERNAME || 'default';
  return resolve(process.cwd(), 'src', 'data', `private-chat-${username}.json`);
}

function isPrivateChatMessage(value: any): value is PrivateChatMessage {
  return (
    value &&
    (value.type === 'user' || value.type === 'ai') &&
    typeof value.username === 'string' &&
    typeof value.message === 'string' &&
    typeof value.timestamp === 'string'
  );
}

async function readAllUnsafe(): Promise<PrivateChatMessage[]> {
  try {
    const raw = await fs.readFile(getPrivateChatFilePath(), 'utf-8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isPrivateChatMessage);
  } catch {
    return [];
  }
}

export async function readPrivateChatMessages(limit?: number): Promise<PrivateChatMessage[]> {
  try {
    const all = await readAllUnsafe();
    if (!limit || limit <= 0) return all;
    return all.slice(-limit);
  } catch {
    return [];
  }
}

export async function appendPrivateChatMessages(
  newMessages: PrivateChatMessage[],
  maxMessages = 100
): Promise<PrivateChatMessage[]> {
  const safeMax = maxMessages > 0 ? maxMessages : 100;

  const existing = await readPrivateChatMessages();
  const merged = [...existing, ...newMessages].filter(isPrivateChatMessage);
  const trimmed = merged.length > safeMax ? merged.slice(-safeMax) : merged;

  await fs.writeFile(getPrivateChatFilePath(), JSON.stringify(trimmed, null, 2));
  return trimmed;
}

export { getPrivateChatFilePath };
