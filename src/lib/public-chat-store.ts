import * as fs from 'fs/promises';
import { resolve } from 'path';
import { readUserConfigSync } from '@/lib/user-config';
import { tenantPath } from '@/lib/tenant';

export type PublicChatMessage = {
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

function normalizePublicChatMessage(value: PublicChatMessage): PublicChatMessage {
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

async function readAllUnsafe(tenantId?: string): Promise<PublicChatMessage[]> {
  try {
    const raw = await fs.readFile(getPublicChatFilePath(tenantId), 'utf-8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isPublicChatMessage).map(normalizePublicChatMessage);
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
  const merged = [...existing, ...newMessages].filter(isPublicChatMessage).map(normalizePublicChatMessage);
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
