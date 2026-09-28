import type { SharedChatEventV1 } from '@/contracts/shared-chat-event';

type JsonRecord = Record<string, any>;
type CacheEntry = { expiresAt: number; value: any };

const DISCORD_API_BASE = 'https://discord.com/api/v10';
const DISCORD_CDN_BASE = 'https://cdn.discordapp.com';
const DISCORD_MEDIA_BASE = 'https://media.discordapp.net';
const cache = new Map<string, CacheEntry>();

function now() {
  return Date.now();
}

function cached<T>(key: string): T | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt <= now()) {
    cache.delete(key);
    return undefined;
  }
  return entry.value as T;
}

function remember(key: string, value: any, ttlMs: number) {
  if (cache.size > 2_000) {
    for (const [cacheKey, entry] of cache) {
      if (entry.expiresAt <= now()) cache.delete(cacheKey);
      if (cache.size <= 1_500) break;
    }
  }
  cache.set(key, { expiresAt: now() + ttlMs, value });
  return value;
}

async function discordJson(path: string, ttlMs: number): Promise<any | null> {
  const token = String(process.env.DISCORD_BOT_TOKEN || '').trim();
  if (!token) return null;
  const key = `discord:${path}`;
  const hit = cached<any>(key);
  if (hit !== undefined) return hit;

  try {
    const response = await fetch(`${DISCORD_API_BASE}${path}`, {
      headers: {
        Authorization: `Bot ${token}`,
        Accept: 'application/json',
        'User-Agent': 'DiscordBot (https://streamweaver-new.fly.dev, 1.0)',
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(1_800),
    });
    if (!response.ok) return remember(key, null, Math.min(ttlMs, 30_000));
    return remember(key, await response.json(), ttlMs);
  } catch {
    return remember(key, null, Math.min(ttlMs, 30_000));
  }
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function rawDiscordChannelId(event: SharedChatEventV1): string {
  const metaChannel = text((event.meta as JsonRecord | undefined)?.channelId);
  const raw = metaChannel || text(event.channelId).replace(/^discord:/i, '');
  return /^\d{5,24}$/.test(raw) ? raw : '';
}

function isDiscordEvent(event: SharedChatEventV1): boolean {
  return event.platform === 'discord'
    || (event.platform === 'social-stream' && String((event.meta as JsonRecord | undefined)?.rawProvider || '').toLowerCase() === 'discord');
}

function discordAvatarUrl(user: JsonRecord | null | undefined, member: JsonRecord | null | undefined, guildId: string): string | undefined {
  const userId = text(user?.id);
  const memberAvatar = text(member?.avatar);
  if (userId && guildId && memberAvatar) {
    return `${DISCORD_CDN_BASE}/guilds/${guildId}/users/${userId}/avatars/${memberAvatar}.webp?size=128&animated=true`;
  }
  const avatar = text(user?.avatar);
  if (userId && avatar) {
    return `${DISCORD_CDN_BASE}/avatars/${userId}/${avatar}.webp?size=128&animated=true`;
  }
  if (userId && /^\d+$/.test(userId)) {
    try {
      const index = Number((BigInt(userId) >> 22n) % 6n);
      return `${DISCORD_CDN_BASE}/embed/avatars/${index}.png`;
    } catch {}
  }
  return undefined;
}

function extension(url: string): string {
  try {
    return new URL(url).pathname.split('.').pop()?.toLowerCase() || '';
  } catch {
    return '';
  }
}

function attachmentMedia(attachment: JsonRecord) {
  const url = text(attachment.url) || text(attachment.proxy_url);
  if (!/^https?:\/\//i.test(url)) return null;
  const contentType = text(attachment.content_type).toLowerCase();
  const ext = extension(url);
  const filename = text(attachment.filename) || 'Discord attachment';
  const common = {
    url,
    alt: text(attachment.description) || filename,
    width: Number(attachment.width) > 0 ? Number(attachment.width) : undefined,
    height: Number(attachment.height) > 0 ? Number(attachment.height) : undefined,
    meta: { discordAttachmentId: text(attachment.id), filename, spoiler: Boolean(Number(attachment.flags || 0) & (1 << 3)) },
  };
  if (contentType.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif'].includes(ext)) return { type: 'image' as const, ...common };
  if (contentType.startsWith('video/') || ['mp4', 'webm', 'mov'].includes(ext)) return { type: 'video' as const, ...common };
  if (contentType.startsWith('audio/') || ['mp3', 'wav', 'ogg', 'm4a', 'flac'].includes(ext)) return { type: 'audio' as const, ...common };
  return { type: 'link-preview' as const, ...common };
}

function safeRemoteUrl(value: unknown): string {
  const raw = text(value);
  if (!raw || raw.startsWith('attachment://')) return '';
  try {
    const parsed = new URL(raw);
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.href : '';
  } catch {
    return '';
  }
}

function embedMedia(embed: JsonRecord) {
  const output: any[] = [];
  const imageUrl = safeRemoteUrl(embed.image?.url || embed.image?.proxy_url);
  const thumbnailUrl = safeRemoteUrl(embed.thumbnail?.url || embed.thumbnail?.proxy_url);
  const videoUrl = safeRemoteUrl(embed.video?.url || embed.video?.proxy_url);
  const primaryUrl = safeRemoteUrl(embed.url);
  const label = text(embed.title) || text(embed.description).slice(0, 140) || text(embed.provider?.name) || 'Discord embed';

  if (videoUrl) {
    output.push({ type: 'video', url: videoUrl, thumbnailUrl: thumbnailUrl || undefined, alt: label, meta: { discordEmbedType: text(embed.type) || 'video' } });
  }
  if (imageUrl) {
    output.push({ type: 'image', url: imageUrl, thumbnailUrl: thumbnailUrl || undefined, alt: label, meta: { discordEmbedType: text(embed.type) || 'image' } });
  } else if (thumbnailUrl && !videoUrl) {
    output.push({ type: 'image', url: thumbnailUrl, alt: label, meta: { discordEmbedType: text(embed.type) || 'thumbnail' } });
  }
  if (primaryUrl && !output.some((item) => item.url === primaryUrl)) {
    output.push({ type: 'link-preview', url: primaryUrl, thumbnailUrl: thumbnailUrl || undefined, alt: label, meta: { discordEmbedType: text(embed.type) || 'link' } });
  }
  return output;
}

function stickerMedia(sticker: JsonRecord) {
  const id = text(sticker.id);
  if (!id) return null;
  const format = Number(sticker.format_type || 0);
  const animatedGif = format === 4;
  return {
    type: 'sticker' as const,
    url: animatedGif
      ? `${DISCORD_MEDIA_BASE}/stickers/${id}.gif`
      : `${DISCORD_CDN_BASE}/stickers/${id}.png`,
    alt: text(sticker.name) || 'Discord sticker',
    meta: { discordStickerId: id, formatType: format },
  };
}

function customEmojiMedia(content: string) {
  const output: any[] = [];
  const seen = new Set<string>();
  for (const match of content.matchAll(/<(a?):([A-Za-z0-9_~.-]{1,64}):(\d{5,24})>/g)) {
    const animated = match[1] === 'a';
    const name = match[2];
    const id = match[3];
    if (seen.has(id)) continue;
    seen.add(id);
    output.push({
      type: 'emote',
      url: `${DISCORD_CDN_BASE}/emojis/${id}.webp?size=64${animated ? '&animated=true' : ''}`,
      alt: `:${name}:`,
      meta: { discordEmojiId: id, name, animated },
    });
  }
  return output;
}

function mediaKey(item: any) {
  return `${String(item?.type || '')}:${String(item?.url || '')}`;
}

function dedupeMedia(items: any[]) {
  const byKey = new Map<string, any>();
  for (const item of items) {
    const key = mediaKey(item);
    if (!item?.url || byKey.has(key)) continue;
    byKey.set(key, item);
  }
  return Array.from(byKey.values()).slice(0, 20);
}

function summarizeEmbeds(embeds: JsonRecord[]) {
  return embeds.slice(0, 10).map((embed) => ({
    type: text(embed.type),
    title: text(embed.title),
    description: text(embed.description).slice(0, 1_500),
    url: safeRemoteUrl(embed.url) || undefined,
    author: text(embed.author?.name) || undefined,
    provider: text(embed.provider?.name) || undefined,
    footer: text(embed.footer?.text) || undefined,
    fields: Array.isArray(embed.fields)
      ? embed.fields.slice(0, 25).map((field: JsonRecord) => ({ name: text(field.name), value: text(field.value).slice(0, 1_000), inline: Boolean(field.inline) }))
      : [],
  }));
}

function resolveDiscordText(content: string, message: JsonRecord | null, channelNames: Map<string, string>, roleNames: Map<string, string>) {
  let resolved = content;
  const mentionNames = new Map<string, string>();
  for (const mention of Array.isArray(message?.mentions) ? message!.mentions : []) {
    const id = text(mention?.id);
    const name = text(mention?.member?.nick) || text(mention?.global_name) || text(mention?.username);
    if (id && name) mentionNames.set(id, name);
  }
  resolved = resolved.replace(/<@!?(\d+)>/g, (token, id) => mentionNames.has(id) ? `@${mentionNames.get(id)}` : token);
  resolved = resolved.replace(/<#(\d+)>/g, (token, id) => channelNames.has(id) ? `#${channelNames.get(id)}` : token);
  resolved = resolved.replace(/<@&(\d+)>/g, (token, id) => roleNames.has(id) ? `@${roleNames.get(id)}` : token);
  return resolved;
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function run() {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, items.length)) }, run));
  return results;
}

export async function enrichDiscordSharedChatEvents(events: SharedChatEventV1[]): Promise<SharedChatEventV1[]> {
  if (!String(process.env.DISCORD_BOT_TOKEN || '').trim()) return events;

  const discordEvents = events.filter(isDiscordEvent);
  if (!discordEvents.length) return events;

  const channelIds = Array.from(new Set(discordEvents.map(rawDiscordChannelId).filter(Boolean))).slice(0, 12);
  const channelById = new Map<string, JsonRecord>();
  const messagesByLane = new Map<string, JsonRecord>();

  await mapWithConcurrency(channelIds, 12, async (channelId) => {
    const [channel, messages] = await Promise.all([
      discordJson(`/channels/${channelId}`, 10 * 60_000),
      discordJson(`/channels/${channelId}/messages?limit=50`, 45_000),
    ]);
    if (channel && typeof channel === 'object') channelById.set(channelId, channel);
    if (Array.isArray(messages)) {
      for (const message of messages) {
        const id = text(message?.id);
        if (id) messagesByLane.set(`${channelId}:${id}`, message);
      }
    }
    return null;
  });

  const guildIds = Array.from(new Set([
    ...Array.from(channelById.values()).map((channel) => text(channel.guild_id)),
    ...discordEvents.map((event) => text((event.meta as JsonRecord | undefined)?.guildId)),
  ].filter(Boolean))).slice(0, 20);
  const guildById = new Map<string, JsonRecord>();
  const rolesByGuild = new Map<string, Map<string, string>>();

  await mapWithConcurrency(guildIds, 4, async (guildId) => {
    const [guild, roles] = await Promise.all([
      discordJson(`/guilds/${guildId}`, 15 * 60_000),
      discordJson(`/guilds/${guildId}/roles`, 15 * 60_000),
    ]);
    if (guild && typeof guild === 'object') guildById.set(guildId, guild);
    const names = new Map<string, string>();
    if (Array.isArray(roles)) {
      for (const role of roles) {
        const id = text(role?.id);
        const name = text(role?.name);
        if (id && name) names.set(id, name);
      }
    }
    rolesByGuild.set(guildId, names);
    return null;
  });

  const channelNames = new Map<string, string>();
  for (const [id, channel] of channelById) {
    const name = text(channel.name);
    if (name) channelNames.set(id, name);
  }

  return events.map((event) => {
    if (!isDiscordEvent(event)) return event;

    const channelId = rawDiscordChannelId(event);
    const channel = channelById.get(channelId) || null;
    const guildId = text(channel?.guild_id) || text((event.meta as JsonRecord | undefined)?.guildId);
    const guild = guildById.get(guildId) || null;
    const message = messagesByLane.get(`${channelId}:${event.upstreamId}`) || null;
    const author = message?.author && typeof message.author === 'object' ? message.author : null;
    const member = message?.member && typeof message.member === 'object' ? message.member : null;
    const channelNameRaw = text(channel?.name) || text(event.channelName);
    const channelName = channelNameRaw && !/^discord:\d+$/i.test(channelNameRaw)
      ? (channelNameRaw.startsWith('#') || !guildId ? channelNameRaw : `#${channelNameRaw}`)
      : event.channelName;
    const displayName = text(member?.nick) || text(author?.global_name) || text(author?.username) || event.sender.displayName;
    const login = text(author?.username) || event.sender.login;
    const avatarUrl = discordAvatarUrl(author, member, guildId) || event.sender.avatarUrl;
    const content = text(message?.content) || event.text;
    const roles = new Set(event.sender.roles || []);
    if (author?.bot) roles.add('bot');
    if (!roles.size) roles.add('viewer');

    const attachments = Array.isArray(message?.attachments) ? message.attachments : [];
    const embeds = Array.isArray(message?.embeds) ? message.embeds : [];
    const stickers = Array.isArray(message?.sticker_items) ? message.sticker_items : [];
    const media = dedupeMedia([
      ...(event.media || []),
      ...attachments.map(attachmentMedia).filter(Boolean),
      ...embeds.flatMap(embedMedia),
      ...stickers.map(stickerMedia).filter(Boolean),
      ...customEmojiMedia(content),
    ]);

    const referenced = message?.referenced_message && typeof message.referenced_message === 'object'
      ? message.referenced_message as JsonRecord
      : null;
    const referencedAuthor = referenced?.author && typeof referenced.author === 'object' ? referenced.author as JsonRecord : null;
    const reply = referenced
      ? {
          upstreamId: text(referenced.id) || undefined,
          senderId: text(referencedAuthor?.id) || undefined,
          senderName: text(referencedAuthor?.global_name) || text(referencedAuthor?.username) || undefined,
          text: text(referenced.content).slice(0, 500) || undefined,
        }
      : event.reply;

    return {
      ...event,
      sourceName: text(guild?.name) || event.sourceName,
      channelId: channelId || event.channelId,
      channelName: channelName || event.channelName,
      sender: {
        ...event.sender,
        id: text(author?.id) || event.sender.id,
        login: login || undefined,
        displayName: displayName || event.sender.displayName,
        avatarUrl,
        roles: Array.from(roles),
      },
      text: resolveDiscordText(content, message, channelNames, rolesByGuild.get(guildId) || new Map()),
      media,
      reply,
      editedAt: text(message?.edited_timestamp) || event.editedAt,
      // Old replay entries may have been recorded when Discord incorrectly
      // advertised canReply=true. Hydration repairs that stale capability too.
      routing: { ...event.routing, canReply: false, replyTarget: undefined },
      meta: {
        ...(event.meta || {}),
        mentions: Array.isArray(message?.mentions)
          ? message.mentions.slice(0, 50).map((mention: JsonRecord) => ({
              id: text(mention.id),
              username: text(mention.username),
              displayName: text(mention.global_name) || text(mention.username),
            }))
          : (event.meta as JsonRecord | undefined)?.mentions,
        discord: {
          hydrated: Boolean(message || channel),
          guildId: guildId || undefined,
          guildName: text(guild?.name) || undefined,
          channelId: channelId || undefined,
          channelName: channelNameRaw || undefined,
          messageType: message?.type,
          pinned: Boolean(message?.pinned),
          embeds: summarizeEmbeds(embeds),
          attachmentCount: attachments.length,
          stickerCount: stickers.length,
          componentCount: Array.isArray(message?.components) ? message.components.length : 0,
        },
      },
    } as SharedChatEventV1;
  });
}
