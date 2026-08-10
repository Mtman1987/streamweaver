import * as fs from 'fs/promises';
import { resolve } from 'path';
import { readUserConfigSync } from '@/lib/user-config';
import { tenantPath } from '@/lib/tenant';

export type PrivateChatMessage = {
  type: 'user' | 'ai';
  username: string;
  message: string;
  timestamp: string;
  attachments?: Array<{
    id: string;
    url: string;
    filename: string;
    content_type?: string;
  }>;
  embeds?: Array<{
    title?: string;
    description?: string;
    url?: string;
    image?: { url?: string };
    thumbnail?: { url?: string };
  }>;
};

function getPrivateChatFilePath(tenantId?: string): string {
  if (tenantId) {
    return tenantPath(tenantId, 'data/private-chat.json');
  }
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

function normalizePrivateChatMessage(value: PrivateChatMessage): PrivateChatMessage {
  const attachments = Array.isArray(value.attachments)
    ? value.attachments
        .map((attachment: any) => ({
          id: String(attachment?.id || attachment?.url || attachment?.filename || ''),
          url: String(attachment?.url || attachment?.proxy_url || ''),
          filename: String(attachment?.filename || attachment?.name || 'attachment'),
          content_type: attachment?.content_type ? String(attachment.content_type) : undefined,
        }))
        .filter((attachment) => attachment.url)
    : undefined;
  const embeds = Array.isArray(value.embeds)
    ? value.embeds
        .map((embed: any) => ({
          title: embed?.title ? String(embed.title) : undefined,
          description: embed?.description ? String(embed.description) : undefined,
          url: embed?.url ? String(embed.url) : undefined,
          image: embed?.image?.url ? { url: String(embed.image.url) } : undefined,
          thumbnail: embed?.thumbnail?.url ? { url: String(embed.thumbnail.url) } : undefined,
        }))
        .filter((embed) => embed.title || embed.description || embed.url || embed.image?.url || embed.thumbnail?.url)
    : undefined;

  return {
    type: value.type,
    username: value.username,
    message: value.message,
    timestamp: value.timestamp,
    ...(attachments?.length ? { attachments } : {}),
    ...(embeds?.length ? { embeds } : {}),
  };
}

async function readAllUnsafe(tenantId?: string): Promise<PrivateChatMessage[]> {
  try {
    const raw = await fs.readFile(getPrivateChatFilePath(tenantId), 'utf-8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isPrivateChatMessage).map(normalizePrivateChatMessage);
  } catch {
    return [];
  }
}

export async function readPrivateChatMessages(limit?: number, tenantId?: string): Promise<PrivateChatMessage[]> {
  try {
    const all = await readAllUnsafe(tenantId);
    if (!limit || limit <= 0) return all;
    return all.slice(-limit);
  } catch {
    return [];
  }
}

export async function appendPrivateChatMessages(
  newMessages: PrivateChatMessage[],
  maxMessages = 100,
  tenantId?: string
): Promise<PrivateChatMessage[]> {
  const safeMax = maxMessages > 0 ? maxMessages : 100;
  const filePath = getPrivateChatFilePath(tenantId);

  // Ensure directory exists
  const dir = resolve(filePath, '..');
  await fs.mkdir(dir, { recursive: true });

  const existing = await readPrivateChatMessages(undefined, tenantId);
  const merged = [...existing, ...newMessages].filter(isPrivateChatMessage).map(normalizePrivateChatMessage);
  const trimmed = merged.length > safeMax ? merged.slice(-safeMax) : merged;

  await fs.writeFile(filePath, JSON.stringify(trimmed, null, 2));
  return trimmed;
}


export function removeLatestMatchingPrivateAiMessage(
  messages: PrivateChatMessage[],
  message: string,
): { messages: PrivateChatMessage[]; removed: boolean } {
  const target = String(message || '').trim();
  if (!target) return { messages, removed: false };

  let matchIndex = -1;
  for (let index = messages.length - 1; index >= 0; index--) {
    const entry = messages[index];
    if (entry.type === 'ai' && entry.message.trim() === target) {
      matchIndex = index;
      break;
    }
  }
  if (matchIndex < 0) return { messages, removed: false };

  return {
    messages: [...messages.slice(0, matchIndex), ...messages.slice(matchIndex + 1)],
    removed: true,
  };
}

export async function deletePrivateChatAiMessage(
  message: string,
  tenantId?: string,
): Promise<boolean> {
  const existing = await readPrivateChatMessages(undefined, tenantId);
  const result = removeLatestMatchingPrivateAiMessage(existing, message);
  if (!result.removed) return false;

  const filePath = getPrivateChatFilePath(tenantId);
  const dir = resolve(filePath, '..');
  const temporary = `${filePath}.tmp.${process.pid}.${Date.now()}`;
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(temporary, JSON.stringify(result.messages, null, 2));
  await fs.rename(temporary, filePath);
  return true;
}

export { getPrivateChatFilePath };
