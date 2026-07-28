import type { PrivateChatMessage } from '@/lib/private-chat-store';
import type { PublicChatMessage } from '@/lib/public-chat-store';
import {
  SHARED_CHAT_EVENT_VERSION,
  makeSharedChatDedupeKey,
  parseSharedChatEventV1,
  type SharedChatEventType,
  type SharedChatEventV1,
} from '@/contracts/shared-chat-event';

export type NormalizedSocialStreamMessage = {
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

function isoTimestamp(value: unknown): string {
  const raw = firstString(value);
  if (raw) {
    const numeric = Number(raw);
    const parsed = Number.isFinite(numeric) && numeric > 0
      ? new Date(numeric < 10_000_000_000 ? numeric * 1000 : numeric)
      : new Date(raw);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return new Date().toISOString();
}

function safeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 180) || 'unknown';
}

function eventType(body: Record<string, unknown>): SharedChatEventType {
  const raw = firstString(body.event, body.eventType, body.type).toLowerCase();
  if (body.hasDonation || body.donation || raw.includes('donation') || raw.includes('superchat')) return 'donation';
  if (body.membership || raw.includes('membership') || raw.includes('member')) return 'membership';
  if (raw.includes('delete')) return 'delete';
  if (raw.includes('edit')) return 'edit';
  return 'message';
}

function donationFrom(body: Record<string, unknown>) {
  const donation = body.donation && typeof body.donation === 'object'
    ? body.donation as Record<string, unknown>
    : {};
  const display = firstString(body.hasDonation, donation.display, donation.text, body.donation);
  const rawAmount = firstString(donation.amount, body.amount);
  const amount = rawAmount ? Number(rawAmount.replace(/[^0-9.-]/g, '')) : NaN;
  const currency = firstString(donation.currency, body.currency).toUpperCase();
  if (!Number.isFinite(amount) || amount < 0 || currency.length < 3) return undefined;
  return { amount, currency, ...(display ? { display } : {}) };
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

export function normalizeSocialStreamSharedChatEvent(
  input: unknown,
  tenantId: string,
): SharedChatEventV1 | null {
  if (!input || typeof input !== 'object' || !tenantId.trim()) return null;
  const body = input as Record<string, unknown>;
  const meta = body.meta && typeof body.meta === 'object' ? body.meta as Record<string, unknown> : {};
  const legacy = normalizeSocialStreamMessage(input);
  if (!legacy) return null;

  const provider = firstString(body.type, body.source, body.platform, meta.source, 'social-stream').toLowerCase();
  const sourceName = firstString(body.sourceName, body.platformName, provider, 'Social Stream');
  const sourceId = `social-stream:${safeId(firstString(body.sourceId, provider, 'bridge').toLowerCase())}`;
  const channelName = firstString(body.channelName, body.channel, body.roomName, body.chatroom, sourceName);
  const channelId = firstString(body.channelId, body.roomId, body.videoId, channelName, sourceId);
  const originalTimestamp = isoTimestamp(body.timestamp || body.time || body.createdAt || meta.timestamp);
  const receivedTimestamp = new Date().toISOString();
  const senderName = legacy.username.replace(/^\[[^\]]+\]\s*/, '') || 'Social Stream User';
  const senderId = firstString(body.userid, body.userId, body.chatid, body.username, body.chatname, senderName);
  const upstreamId = legacy.rawId || [
    sourceId,
    channelId,
    originalTimestamp,
    senderId,
    legacy.message,
  ].join(':');
  const media = (legacy.attachments || []).map((attachment) => ({
    type: (attachment.content_type?.startsWith('video/') ? 'video' : attachment.content_type?.startsWith('audio/') ? 'audio' : 'image') as 'image' | 'video' | 'audio',
    url: attachment.url,
    alt: attachment.filename,
  }));
  const links = Array.from(new Set(legacy.message.match(/https?:\/\/[^\s<>"']+/gi) || []))
    .map((url) => ({ url }));
  const avatarUrl = safeUrl(body.chatimg || body.avatar || meta.avatar) || undefined;
  const type = eventType(body);
  const event = {
    version: SHARED_CHAT_EVENT_VERSION,
    eventId: `evt_${safeId(tenantId)}_social-stream_${safeId(upstreamId)}`,
    upstreamId,
    tenantId,
    platform: 'social-stream',
    sourceId,
    sourceName,
    channelId,
    channelName,
    type,
    sender: {
      id: senderId,
      login: firstString(body.username, body.chatname) || undefined,
      displayName: senderName,
      avatarUrl,
      badges: [],
      roles: ['viewer'],
    },
    text: legacy.message,
    media,
    links,
    donation: type === 'donation' ? donationFrom(body) : undefined,
    membership: type === 'membership'
      ? { tier: firstString(body.membership, body.membershipTier, body.subtitle) || undefined }
      : undefined,
    originalTimestamp,
    receivedTimestamp,
    meta: {
      rawProvider: provider,
      socialStream: true,
    },
    dedupeKey: makeSharedChatDedupeKey({
      tenantId,
      platform: 'social-stream',
      sourceId,
      channelId,
      upstreamId,
    }),
    routing: {
      mirrored: true,
      reflected: false,
      canReply: false,
      botReadable: true,
      botCanReply: false,
      tenantIsolationKey: tenantId,
    },
  } satisfies unknown;

  return parseSharedChatEventV1(event);
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
