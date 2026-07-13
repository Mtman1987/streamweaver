import type { PrivateChatMessage } from '@/lib/private-chat-store';
import type { PublicChatMessage } from '@/lib/public-chat-store';

type NormalizedSocialStreamMessage = {
  username: string;
  message: string;
  source: string;
  timestamp: string;
  attachments?: PublicChatMessage['attachments'];
  embeds?: PublicChatMessage['embeds'];
  rawId?: string;
};

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return '';
}

function safeUrl(value: unknown): string {
  const raw = firstString(value);
  if (!raw || raw.length > 2048) return '';
  if (raw.startsWith('data:image/') && raw.length <= 512_000) return raw;
  if (!/^https?:\/\//i.test(raw)) return '';
  try {
    const parsed = new URL(raw);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? raw : '';
  } catch {
    return '';
  }
}

function normalizeAttachment(value: unknown, fallbackId: string): NonNullable<PublicChatMessage['attachments']>[number] | null {
  if (!value || typeof value !== 'object') {
    const url = safeUrl(value);
    return url ? { id: `${fallbackId}:media`, url, filename: 'social-stream-media' } : null;
  }

  const source = value as Record<string, unknown>;
  const url = safeUrl(source.url || source.contentimg || source.src || source.href);
  if (!url) return null;

  return {
    id: firstString(source.id, url, fallbackId),
    url,
    filename: firstString(source.filename, source.name, 'social-stream-media'),
    ...(firstString(source.content_type, source.contentType, source.type) ? {
      content_type: firstString(source.content_type, source.contentType, source.type),
    } : {}),
  };
}

export function normalizeSocialStreamMessage(input: unknown): NormalizedSocialStreamMessage | null {
  if (!input || typeof input !== 'object') return null;
  const body = input as Record<string, unknown>;
  const meta = body.meta && typeof body.meta === 'object' ? body.meta as Record<string, unknown> : {};

  const username = firstString(body.chatname, body.name, body.username, body.displayName, meta.username, 'Social Stream User');
  const source = firstString(body.type, body.source, body.platform, meta.source, 'social-stream');
  const message = firstString(body.chatmessage, body.message, body.text, body.comment, body.event, body.hasDonation);
  const rawId = firstString(body.id, body.mid, body.messageId, meta.id, meta.messageId);
  const timestamp = firstString(body.timestamp, body.time, body.createdAt, meta.timestamp) || new Date().toISOString();
  const attachmentSeed = rawId || `${source}:${username}:${timestamp}`;

  const attachments: NonNullable<PublicChatMessage['attachments']> = [];
  const contentImage = normalizeAttachment(body.contentimg || body.image || body.media, attachmentSeed);
  if (contentImage) attachments.push(contentImage);

  if (Array.isArray(body.attachments)) {
    for (const item of body.attachments) {
      const attachment = normalizeAttachment(item, attachmentSeed);
      if (attachment) attachments.push(attachment);
    }
  }

  const avatarUrl = safeUrl(body.chatimg || body.avatar || meta.avatar);
  const embeds: NonNullable<PublicChatMessage['embeds']> = [];
  if (avatarUrl || body.hasDonation || body.subtitle || body.membership) {
    embeds.push({
      title: firstString(body.hasDonation, body.membership, body.subtitle, `${source} event`),
      description: firstString(body.subtitle, body.membership),
      thumbnail: avatarUrl ? { url: avatarUrl } : undefined,
    });
  }

  if (!message && attachments.length === 0 && embeds.length === 0) return null;

  return {
    username: `[${source}] ${username}`,
    message,
    source,
    timestamp,
    rawId: rawId || undefined,
    ...(attachments.length ? { attachments } : {}),
    ...(embeds.length ? { embeds } : {}),
  };
}

export function toPublicChatMessage(message: NormalizedSocialStreamMessage): PublicChatMessage {
  return {
    type: 'user',
    username: message.username,
    message: message.message,
    timestamp: message.timestamp,
    ...(message.attachments?.length ? { attachments: message.attachments } : {}),
    ...(message.embeds?.length ? { embeds: message.embeds } : {}),
  };
}

export function toPrivateChatMessage(message: NormalizedSocialStreamMessage): PrivateChatMessage {
  return {
    type: 'user',
    username: message.username,
    message: message.message,
    timestamp: message.timestamp,
    ...(message.attachments?.length ? { attachments: message.attachments } : {}),
    ...(message.embeds?.length ? { embeds: message.embeds } : {}),
  };
}
