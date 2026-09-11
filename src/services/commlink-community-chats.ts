import type { SharedChatEventV1 } from '../contracts/shared-chat-event';
import { listTenants } from '../lib/tenant';
import { getStoredTokens } from '../lib/token-utils.server';
import { readSharedChatReplay } from './shared-chat-ingestion';

export type CommunityChat = { tenantId: string; channelId: string; channelName: string };
let cached: { expires: number; chats: CommunityChat[] } | null = null;

// Discover existing registered streamers. Never join another IRC connection or
// turn access to public Twitch chat into access to a tenant's private state.
export async function listCommlinkCommunityChats(): Promise<CommunityChat[]> {
  if (cached && cached.expires > Date.now()) return cached.chats;
  const chats: CommunityChat[] = [];
  for (const tenantId of await listTenants()) {
    const tokens = await getStoredTokens(tenantId);
    const login = String(tokens?.broadcasterUsername || '').trim().toLowerCase();
    if (!/^[a-z0-9_]{1,25}$/.test(login)) continue;
    chats.push({ tenantId, channelId: /^\d+$/.test(tenantId) ? tenantId : login, channelName: login });
  }
  const unique = [...new Map(chats.map(chat => [chat.channelName, chat])).values()];
  cached = { expires: Date.now() + 30_000, chats: unique };
  return unique;
}

export function projectPublicTwitchMessage(event: SharedChatEventV1, chat: CommunityChat, viewerTenantId: string): SharedChatEventV1 | null {
  // Only native public IRC chat for this registered broadcaster. No Discord,
  // whispers, AI memory, commands, points, cards, private metadata or other rooms.
  if (event.tenantId !== chat.tenantId || event.platform !== 'twitch'
    || event.meta?.rawProvider !== 'tmi' || event.sourceId !== `twitch:${chat.channelName}`
    || event.channelName !== chat.channelName
    || !['message', 'action', 'reply'].includes(event.type)) return null;
  return {
    version: event.version, eventId: event.eventId, upstreamId: event.upstreamId,
    tenantId: viewerTenantId, platform: 'twitch', sourceId: event.sourceId,
    sourceName: chat.channelName, channelId: chat.channelId, channelName: chat.channelName,
    type: event.type, sender: {
      id: event.sender.id, login: event.sender.login, displayName: event.sender.displayName,
      avatarUrl: event.sender.avatarUrl,
      roles: event.sender.roles,
      badges: event.sender.badges.map(badge => ({ id: badge.id, label: badge.label, imageUrl: badge.imageUrl })),
    },
    text: event.text,
    media: event.media.filter(media => media.type === 'emote').map(media => ({ type: media.type, url: media.url, alt: media.alt })),
    links: event.links.map(link => ({ url: link.url, label: link.label })),
    originalTimestamp: event.originalTimestamp, receivedTimestamp: event.receivedTimestamp,
    dedupeKey: event.dedupeKey,
    meta: { publicCommunityChat: true },
    routing: { mirrored: false, reflected: false, canReply: false, botReadable: false, botCanReply: false, tenantIsolationKey: viewerTenantId },
  };
}

export async function readCommlinkCommunityMessages(chats: CommunityChat[], viewerTenantId: string) {
  const messages: SharedChatEventV1[] = [];
  // Bounded reads, batched to avoid opening every tenant file concurrently.
  const others = chats.filter(chat => chat.tenantId !== viewerTenantId);
  for (let offset = 0; offset < others.length; offset += 8) {
    const batches = await Promise.all(others.slice(offset, offset + 8).map(async chat => {
      const replay = await readSharedChatReplay(chat.tenantId, { limit: 50 });
      return replay.map(event => projectPublicTwitchMessage(event, chat, viewerTenantId)).filter((event): event is SharedChatEventV1 => event !== null);
    }));
    messages.push(...batches.flat());
  }
  return messages.sort((a, b) => Date.parse(a.originalTimestamp) - Date.parse(b.originalTimestamp)).slice(-500);
}

export function isCommunityComposeDestination(destination: { platform: string; channelId: string; channelName: string }, chats: CommunityChat[]) {
  return destination.platform === 'twitch' && chats.some(chat => chat.channelId === destination.channelId
    && chat.channelName === destination.channelName.replace(/^#/, '').toLowerCase());
}
