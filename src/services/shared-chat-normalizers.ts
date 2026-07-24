import {
  SHARED_CHAT_EVENT_VERSION,
  makeSharedChatDedupeKey,
  parseSharedChatEventV1,
  type SharedChatBadgeSchema,
  type SharedChatEventType,
  type SharedChatEventV1,
  type SharedChatPlatform,
  type SharedChatRole,
} from '../contracts/shared-chat-event';

type SharedChatBadge = typeof SharedChatBadgeSchema._type;

type UnknownRecord = Record<string, unknown>;

export type TwitchSharedChatInput = {
  tenantId: string;
  channel: string;
  tags: Record<string, any>;
  message: string;
  self?: boolean;
  receivedAt?: Date | string;
};

export type DiscordSharedChatInput = {
  tenantId: string;
  payload: UnknownRecord;
  message?: string;
  traceId?: string;
  receivedAt?: Date | string;
};

export type YouTubeSharedChatInput = {
  tenantId: string;
  liveChatId: string;
  channelId?: string;
  channelName?: string;
  message: {
    id: string;
    authorChannelId: string;
    authorDisplayName: string;
    message: string;
    timestamp: Date | string;
    isSuperChat?: boolean;
    superChatAmount?: number;
    superChatCurrency?: string;
    superChatDisplay?: string;
    isMembership?: boolean;
    membershipLevel?: string;
  };
  receivedAt?: Date | string;
};

export type KickSharedChatInput = {
  tenantId: string;
  channelName: string;
  channelId?: string;
  message: {
    id: string;
    username: string;
    displayName?: string;
    message: string;
    timestamp: Date | string;
    badges?: string[];
    isSubscriber?: boolean;
    isModerator?: boolean;
  };
  receivedAt?: Date | string;
};

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return '';
}

function isoTimestamp(value?: Date | string): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string' && value.trim()) {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  return new Date().toISOString();
}

function stableTimestampFromMs(value: unknown, fallback?: Date | string): string {
  const raw = firstString(value);
  const millis = raw ? Number(raw) : NaN;
  if (Number.isFinite(millis) && millis > 0) return new Date(millis).toISOString();
  return isoTimestamp(fallback);
}

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function linksFromText(text: string) {
  const matches = text.match(/https?:\/\/[^\s<>"']+/gi) || [];
  return Array.from(new Set(matches)).map((url) => ({ url }));
}

function cleanChannelName(channel: string): string {
  return channel.replace(/^#/, '').trim().toLowerCase();
}

function eventIdFor(platform: SharedChatPlatform, tenantId: string, upstreamId: string): string {
  const safeTenant = tenantId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const safeUpstream = upstreamId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return `evt_${safeTenant}_${platform}_${safeUpstream}`;
}

function twitchBadges(tags: Record<string, any>): SharedChatBadge[] {
  const rawBadges = tags.badges && typeof tags.badges === 'object' ? tags.badges : {};
  return Object.entries(rawBadges).map(([id, version]) => ({
    id,
    meta: { version: String(version ?? '') },
  }));
}

function twitchRoles(tags: Record<string, any>, self?: boolean): SharedChatRole[] {
  const badges = tags.badges && typeof tags.badges === 'object' ? tags.badges : {};
  const roles = new Set<SharedChatRole>();
  if (self) roles.add('bot');
  if (badges.broadcaster) roles.add('broadcaster');
  if (tags.mod || badges.moderator) roles.add('moderator');
  if (badges.vip) roles.add('vip');
  if (tags.subscriber || badges.subscriber || badges.founder) roles.add('subscriber');
  if (roles.size === 0) roles.add('viewer');
  return Array.from(roles);
}

export function normalizeTwitchSharedChatEvent(input: TwitchSharedChatInput): SharedChatEventV1 {
  const tenantId = firstString(input.tenantId);
  const channelName = cleanChannelName(input.channel);
  const receivedTimestamp = isoTimestamp(input.receivedAt);
  const originalTimestamp = stableTimestampFromMs(input.tags['tmi-sent-ts'], input.receivedAt);
  const upstreamId = firstString(
    input.tags.id,
    `${channelName}:${firstString(input.tags['tmi-sent-ts'], originalTimestamp)}:${firstString(input.tags['user-id'], input.tags.username, 'unknown')}:${input.message}`,
  );
  const sourceId = `twitch:${channelName}`;
  const channelId = firstString(input.tags['room-id'], channelName);
  const displayName = firstString(input.tags['display-name'], input.tags.username, 'Unknown');
  const event = {
    version: SHARED_CHAT_EVENT_VERSION,
    eventId: eventIdFor('twitch', tenantId, upstreamId),
    upstreamId,
    tenantId,
    platform: 'twitch',
    sourceId,
    sourceName: channelName,
    channelId,
    channelName,
    type: 'message',
    sender: {
      id: firstString(input.tags['user-id'], input.tags.username, 'unknown'),
      login: firstString(input.tags.username) || undefined,
      displayName,
      badges: twitchBadges(input.tags),
      roles: twitchRoles(input.tags, input.self),
    },
    text: input.message,
    sanitizedHtml: escapeHtml(input.message),
    media: [],
    links: linksFromText(input.message),
    originalTimestamp,
    receivedTimestamp,
    meta: {
      rawProvider: 'tmi',
      self: Boolean(input.self),
      mirrored: Boolean(input.tags['source-room-id'] || input.tags['source-id']),
    },
    dedupeKey: makeSharedChatDedupeKey({ tenantId, platform: 'twitch', sourceId, channelId, upstreamId }),
    routing: {
      mirrored: Boolean(input.tags['source-room-id'] || input.tags['source-id']),
      reflected: false,
      canReply: true,
      replyTarget: `twitch:${channelName}`,
      botReadable: true,
      botCanReply: false,
      tenantIsolationKey: tenantId,
    },
  } satisfies unknown;

  return parseSharedChatEventV1(event);
}

function discordRoles(payload: UnknownRecord): SharedChatRole[] {
  const author = (payload.author && typeof payload.author === 'object' ? payload.author : {}) as UnknownRecord;
  const roles = new Set<SharedChatRole>();
  if (payload.isOwner) roles.add('owner');
  if (payload.isAdmin || payload.isMod) roles.add('moderator');
  if (payload.bot || payload.isBot || author.bot) roles.add('bot');
  if (roles.size === 0) roles.add('viewer');
  return Array.from(roles);
}

export function normalizeDiscordSharedChatEvent(input: DiscordSharedChatInput): SharedChatEventV1 {
  const payload = input.payload || {};
  const author = (payload.author && typeof payload.author === 'object' ? payload.author : {}) as UnknownRecord;
  const member = (payload.member && typeof payload.member === 'object' ? payload.member : {}) as UnknownRecord;
  const user = (payload.user && typeof payload.user === 'object' ? payload.user : {}) as UnknownRecord;
  const channel = (payload.channel && typeof payload.channel === 'object' ? payload.channel : {}) as UnknownRecord;
  const guild = (payload.guild && typeof payload.guild === 'object' ? payload.guild : {}) as UnknownRecord;
  const tenantId = firstString(input.tenantId);
  const guildId = firstString(payload.guildId, payload.guild_id, guild.id);
  const channelIdRaw = firstString(payload.channelId, payload.channel_id, channel.id);
  const messageId = firstString(payload.messageId, payload.message_id, payload.id);
  const text = input.message ?? firstString(payload.message, payload.content, payload.cleanContent);
  const receivedTimestamp = isoTimestamp(input.receivedAt);
  const originalTimestamp = isoTimestamp(firstString(payload.createdAt, payload.created_at, payload.timestamp) || input.receivedAt);
  const sourceId = guildId ? `discord:${guildId}` : 'discord:dm';
  const channelId = channelIdRaw ? `discord:${channelIdRaw}` : 'discord:unknown';
  const upstreamId = messageId || `${channelId}:${originalTimestamp}:${firstString(payload.userId, payload.user_id, author.id, user.id, 'unknown')}:${text}`;
  const username = firstString(payload.userName, payload.username, author.username, user.username, payload.displayName, member.displayName, member.nick, 'Unknown');
  const displayName = firstString(payload.displayName, payload.globalName, member.displayName, member.nick, author.global_name, author.username, username, 'Unknown');

  const event = {
    version: SHARED_CHAT_EVENT_VERSION,
    eventId: eventIdFor('discord', tenantId, upstreamId),
    upstreamId,
    tenantId,
    platform: 'discord',
    sourceId,
    sourceName: firstString(payload.guildName, payload.guild_name, guild.name) || undefined,
    channelId,
    channelName: firstString(payload.channelName, payload.channel_name, channel.name) || undefined,
    type: 'message',
    sender: {
      id: firstString(payload.userId, payload.user_id, author.id, user.id, 'unknown'),
      login: username,
      displayName,
      avatarUrl: firstString(payload.userAvatar, payload.avatarUrl, payload.avatar_url, author.avatarUrl, author.displayAvatarURL) || undefined,
      badges: [],
      roles: discordRoles(payload),
    },
    text,
    sanitizedHtml: escapeHtml(text),
    media: [],
    links: linksFromText(text),
    originalTimestamp,
    receivedTimestamp,
    meta: {
      traceId: input.traceId,
      guildId: guildId || undefined,
      channelId: channelIdRaw || undefined,
    },
    dedupeKey: makeSharedChatDedupeKey({ tenantId, platform: 'discord', sourceId, channelId, upstreamId }),
    routing: {
      mirrored: false,
      reflected: false,
      canReply: Boolean(channelIdRaw),
      replyTarget: channelIdRaw ? `discord:${channelIdRaw}` : undefined,
      botReadable: true,
      botCanReply: false,
      tenantIsolationKey: tenantId,
    },
  } satisfies unknown;

  return parseSharedChatEventV1(event);
}

export function normalizeYouTubeSharedChatEvent(input: YouTubeSharedChatInput): SharedChatEventV1 {
  const tenantId = firstString(input.tenantId);
  const msg = input.message;
  const sourceId = `youtube:${input.channelId || input.liveChatId}`;
  const channelId = firstString(input.liveChatId, input.channelId);
  const originalTimestamp = isoTimestamp(msg.timestamp);
  const receivedTimestamp = isoTimestamp(input.receivedAt);
  const type: SharedChatEventType = msg.isSuperChat ? 'donation' : msg.isMembership ? 'membership' : 'message';
  const event = {
    version: SHARED_CHAT_EVENT_VERSION,
    eventId: eventIdFor('youtube', tenantId, msg.id),
    upstreamId: msg.id,
    tenantId,
    platform: 'youtube',
    sourceId,
    sourceName: input.channelName,
    channelId,
    channelName: input.channelName,
    type,
    sender: {
      id: firstString(msg.authorChannelId, 'unknown'),
      login: msg.authorChannelId || undefined,
      displayName: firstString(msg.authorDisplayName, 'Unknown'),
      badges: msg.isSuperChat ? [{ id: 'super_chat' }] : msg.isMembership ? [{ id: 'member' }] : [],
      roles: msg.isMembership ? ['member'] : ['viewer'],
    },
    text: msg.message,
    sanitizedHtml: escapeHtml(msg.message),
    media: [],
    links: linksFromText(msg.message),
    donation: msg.isSuperChat && msg.superChatAmount != null && msg.superChatCurrency
      ? { amount: msg.superChatAmount, currency: msg.superChatCurrency, display: msg.superChatDisplay }
      : undefined,
    membership: msg.isMembership ? { tier: msg.membershipLevel } : undefined,
    originalTimestamp,
    receivedTimestamp,
    meta: { rawProvider: 'youtube' },
    dedupeKey: makeSharedChatDedupeKey({ tenantId, platform: 'youtube', sourceId, channelId, upstreamId: msg.id }),
    routing: {
      mirrored: false,
      reflected: false,
      canReply: true,
      replyTarget: `youtube:${channelId}`,
      botReadable: true,
      botCanReply: false,
      tenantIsolationKey: tenantId,
    },
  } satisfies unknown;

  return parseSharedChatEventV1(event);
}

export function normalizeKickSharedChatEvent(input: KickSharedChatInput): SharedChatEventV1 {
  const tenantId = firstString(input.tenantId);
  const channelName = cleanChannelName(input.channelName);
  const msg = input.message;
  const sourceId = `kick:${channelName}`;
  const channelId = firstString(input.channelId, channelName);
  const originalTimestamp = isoTimestamp(msg.timestamp);
  const roles: SharedChatRole[] = [
    ...(msg.isModerator ? ['moderator' as const] : []),
    ...(msg.isSubscriber ? ['subscriber' as const] : []),
  ];
  const event = {
    version: SHARED_CHAT_EVENT_VERSION,
    eventId: eventIdFor('kick', tenantId, msg.id),
    upstreamId: msg.id,
    tenantId,
    platform: 'kick',
    sourceId,
    sourceName: channelName,
    channelId,
    channelName,
    type: 'message',
    sender: {
      id: firstString(msg.username, 'unknown'),
      login: msg.username,
      displayName: firstString(msg.displayName, msg.username, 'Unknown'),
      badges: (msg.badges || []).map((id) => ({ id })),
      roles: roles.length ? roles : ['viewer'],
    },
    text: msg.message,
    sanitizedHtml: escapeHtml(msg.message),
    media: [],
    links: linksFromText(msg.message),
    originalTimestamp,
    receivedTimestamp: isoTimestamp(input.receivedAt),
    meta: { rawProvider: 'kick' },
    dedupeKey: makeSharedChatDedupeKey({ tenantId, platform: 'kick', sourceId, channelId, upstreamId: msg.id }),
    routing: {
      mirrored: false,
      reflected: false,
      canReply: true,
      replyTarget: `kick:${channelName}`,
      botReadable: true,
      botCanReply: false,
      tenantIsolationKey: tenantId,
    },
  } satisfies unknown;

  return parseSharedChatEventV1(event);
}
