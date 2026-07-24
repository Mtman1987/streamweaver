import { z } from 'zod';

export const SHARED_CHAT_EVENT_VERSION = 'shared-chat-event.v1' as const;

export const SharedChatPlatformSchema = z.enum([
  'twitch',
  'discord',
  'kick',
  'youtube',
  'app',
  'social-stream',
]);

export const SharedChatEventTypeSchema = z.enum([
  'message',
  'action',
  'reply',
  'donation',
  'membership',
  'reward',
  'raid',
  'follow',
  'delete',
  'edit',
  'system',
]);

export const SharedChatRoleSchema = z.enum([
  'owner',
  'broadcaster',
  'moderator',
  'vip',
  'subscriber',
  'member',
  'bot',
  'viewer',
]);

export const SharedChatBadgeSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1).optional(),
  imageUrl: z.string().url().optional(),
  meta: z.record(z.unknown()).optional(),
});

export const SharedChatMediaSchema = z.object({
  type: z.enum(['image', 'video', 'audio', 'sticker', 'emote', 'link-preview']),
  url: z.string().url(),
  thumbnailUrl: z.string().url().optional(),
  alt: z.string().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  meta: z.record(z.unknown()).optional(),
});

export const SharedChatLinkSchema = z.object({
  url: z.string().url(),
  label: z.string().optional(),
  safe: z.boolean().optional(),
  meta: z.record(z.unknown()).optional(),
});

export const SharedChatMoneySchema = z.object({
  amount: z.number().nonnegative(),
  currency: z.string().min(3).max(8),
  display: z.string().min(1).optional(),
});

export const SharedChatReplyContextSchema = z.object({
  eventId: z.string().min(1).optional(),
  upstreamId: z.string().min(1).optional(),
  senderId: z.string().min(1).optional(),
  senderName: z.string().min(1).optional(),
  text: z.string().optional(),
});

export const SharedChatRoutingSchema = z.object({
  mirrored: z.boolean().default(false),
  reflected: z.boolean().default(false),
  canReply: z.boolean().default(false),
  replyTarget: z.string().min(1).optional(),
  botReadable: z.boolean().default(false),
  botCanReply: z.boolean().default(false),
  tenantIsolationKey: z.string().min(1),
});

export const SharedChatSenderSchema = z.object({
  id: z.string().min(1),
  login: z.string().min(1).optional(),
  displayName: z.string().min(1),
  avatarUrl: z.string().url().optional(),
  badges: z.array(SharedChatBadgeSchema).default([]),
  roles: z.array(SharedChatRoleSchema).default(['viewer']),
});

export const SharedChatEventV1Schema = z.object({
  version: z.literal(SHARED_CHAT_EVENT_VERSION),
  eventId: z.string().min(1),
  upstreamId: z.string().min(1),
  tenantId: z.string().min(1),
  platform: SharedChatPlatformSchema,
  sourceId: z.string().min(1),
  sourceName: z.string().min(1).optional(),
  channelId: z.string().min(1),
  channelName: z.string().min(1).optional(),
  type: SharedChatEventTypeSchema,
  sender: SharedChatSenderSchema,
  text: z.string().default(''),
  sanitizedHtml: z.string().optional(),
  media: z.array(SharedChatMediaSchema).default([]),
  links: z.array(SharedChatLinkSchema).default([]),
  donation: SharedChatMoneySchema.optional(),
  membership: z.object({
    tier: z.string().min(1).optional(),
    months: z.number().int().nonnegative().optional(),
    gifted: z.boolean().optional(),
  }).optional(),
  reward: z.object({
    id: z.string().min(1).optional(),
    title: z.string().min(1).optional(),
    cost: z.number().int().nonnegative().optional(),
  }).optional(),
  reply: SharedChatReplyContextSchema.optional(),
  originalTimestamp: z.string().datetime(),
  receivedTimestamp: z.string().datetime(),
  editedAt: z.string().datetime().optional(),
  deletedAt: z.string().datetime().optional(),
  meta: z.record(z.unknown()).default({}),
  dedupeKey: z.string().min(1),
  routing: SharedChatRoutingSchema,
});

export type SharedChatPlatform = z.infer<typeof SharedChatPlatformSchema>;
export type SharedChatEventType = z.infer<typeof SharedChatEventTypeSchema>;
export type SharedChatRole = z.infer<typeof SharedChatRoleSchema>;
export type SharedChatEventV1 = z.infer<typeof SharedChatEventV1Schema>;

export function parseSharedChatEventV1(input: unknown): SharedChatEventV1 {
  return SharedChatEventV1Schema.parse(input);
}

export function makeSharedChatDedupeKey(input: {
  tenantId: string;
  platform: SharedChatPlatform;
  sourceId: string;
  channelId: string;
  upstreamId: string;
}): string {
  return [
    SHARED_CHAT_EVENT_VERSION,
    input.tenantId,
    input.platform,
    input.sourceId,
    input.channelId,
    input.upstreamId,
  ].join(':');
}
