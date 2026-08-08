import { listTenants } from '@/lib/tenant';
import { readWorldLore } from '@/lib/world-lore-store';
import { getBotName } from '@/lib/bot-settings-store';
import { getStoredTokens } from '@/lib/token-utils.server';
import { deleteMessage, editDiscordMessage, sendDiscordEmbed } from './discord-local';
import {
  buildDiscordBotEmbed,
  getDiscordBotWebhookIdentity,
} from './discord-branding';
import { getAvatarUrlForTenant } from './discord-webhook-avatar';
import { recordDiscordMessageCleanup, getDiscordMessageCleanupDeleteAt } from './discord-message-cleanup';
import { sendWebhookMessage } from './discord-webhooks';
import { getTwitchUser } from './twitch';
import { attachPrivateDmControls } from './private-dm-controls';

const SPACEMOUNTAIN_FALLBACK_LOGO = 'https://spacemountain.live/assets/space-logo-main.png';

export type DiscordReplySpeaker = {
  botName: string;
  tenantId?: string;
  stableId: string;
};

export type StructuredDiscordReplyInput = {
  channelId: string;
  message: string;
  tenantId?: string;
  botName?: string;
  title?: string;
  responseType?: string;
  rotateSpeaker?: boolean;
  speaker?: DiscordReplySpeaker;
  sourceMessageId?: string;
  sourceMessage?: string;
  sourceUser?: string;
  sourceUserAvatarUrl?: string;
  isPrivate?: boolean;
  imageUrl?: string;
  thumbnailUrl?: string;
  color?: number;
  fields?: Array<{ name: string; value: string; inline?: boolean }>;
  components?: Record<string, unknown>[];
  extraEmbeds?: Record<string, unknown>[];
  embedUrl?: string;
};

let rotatingSpeakerIndex = 0;

function firstUrl(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const text = value.trim();
    if (/^https?:\/\//i.test(text)) return text;
  }
  return '';
}

function uniqueSpeakers(speakers: DiscordReplySpeaker[]): DiscordReplySpeaker[] {
  const seen = new Set<string>();
  const unique: DiscordReplySpeaker[] = [];
  for (const speaker of speakers) {
    const key = `${speaker.tenantId || 'global'}:${speaker.botName.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(speaker);
  }
  return unique;
}

async function getCommandReplySpeakers(fallbackTenantId?: string): Promise<DiscordReplySpeaker[]> {
  const speakers: DiscordReplySpeaker[] = [];
  const lore = await readWorldLore().catch(() => null);
  const characters = Object.values(lore?.characters || {});

  for (const character of characters) {
    const [tenantId] = String(character.stableId || '').split(':');
    speakers.push({
      botName: character.currentName,
      tenantId: tenantId && !['unknown', 'discordUserId', 'twitchUserId'].includes(tenantId) ? tenantId : undefined,
      stableId: character.stableId,
    });
  }

  for (const tenantId of await listTenants().catch(() => [])) {
    if (tenantId.startsWith('__kick_silent__')) continue;
    const botName = getBotName(tenantId);
    if (!botName) continue;
    speakers.push({
      botName,
      tenantId,
      stableId: `${tenantId}:${botName.toLowerCase()}`,
    });
  }

  const unique = uniqueSpeakers(speakers);
  if (unique.length > 0) return unique;

  const fallbackBotName = getBotName(fallbackTenantId) || getBotName() || 'StreamWeaver';
  return [{
    botName: fallbackBotName,
    tenantId: fallbackTenantId,
    stableId: `${fallbackTenantId || 'global'}:${fallbackBotName.toLowerCase()}`,
  }];
}

export async function resolveStructuredDiscordReplySpeaker(input: {
  tenantId?: string;
  botName?: string;
  rotateSpeaker?: boolean;
  isPrivate?: boolean;
}): Promise<DiscordReplySpeaker> {
  if (input.isPrivate) {
    const tenantBotName = input.tenantId ? getBotName(input.tenantId) : '';
    const botName = tenantBotName || getBotName() || 'StreamWeaver';
    const tenantId = tenantBotName ? input.tenantId : undefined;
    return {
      botName,
      tenantId,
      stableId: `${tenantId || 'global'}:${botName.toLowerCase()}`,
    };
  }

  if (!input.rotateSpeaker) {
    const botName = input.botName || getBotName(input.tenantId) || getBotName() || 'StreamWeaver';
    return {
      botName,
      tenantId: input.tenantId,
      stableId: `${input.tenantId || 'global'}:${botName.toLowerCase()}`,
    };
  }

  const speakers = await getCommandReplySpeakers(input.tenantId);
  const speaker = speakers[rotatingSpeakerIndex % speakers.length];
  rotatingSpeakerIndex = (rotatingSpeakerIndex + 1) % Math.max(1, speakers.length);
  return speaker;
}

async function resolveTenantOwnerBranding(
  tenantId: string | undefined,
): Promise<{ name: string; logo: string }> {
  if (!tenantId) {
    return { name: 'SpaceMountain.live', logo: SPACEMOUNTAIN_FALLBACK_LOGO };
  }

  const tokens = await getStoredTokens(tenantId).catch(() => null) as Record<string, unknown> | null;
  const ownerName = String(
    tokens?.broadcasterDisplayName ||
    tokens?.broadcasterUsername ||
    tokens?.loginDisplayName ||
    tokens?.loginUsername ||
    'SpaceMountain.live'
  ).trim();

  const configured = firstUrl(
    tokens?.broadcasterAvatarUrl,
    tokens?.broadcasterProfileImageUrl,
    tokens?.loginAvatarUrl,
    tokens?.loginProfileImageUrl,
  );
  if (configured) return { name: ownerName, logo: configured };

  if (ownerName && ownerName !== 'SpaceMountain.live') {
    const profile = await getTwitchUser(ownerName).catch(() => null);
    const profileImage = firstUrl(profile?.profileImageUrl);
    if (profileImage) return { name: ownerName, logo: profileImage };
  }

  return { name: ownerName || 'SpaceMountain.live', logo: SPACEMOUNTAIN_FALLBACK_LOGO };
}

export async function buildStructuredDiscordReplyPayload(input: StructuredDiscordReplyInput): Promise<{
  content: string;
  embeds: Record<string, unknown>[];
  username: string;
  deleteAt: string;
  speaker: DiscordReplySpeaker;
}> {
  const speaker = input.speaker || await resolveStructuredDiscordReplySpeaker({
    tenantId: input.tenantId,
    botName: input.botName,
    rotateSpeaker: input.isPrivate ? false : input.rotateSpeaker,
    isPrivate: input.isPrivate,
  });
  const deleteAt = input.isPrivate ? '' : getDiscordMessageCleanupDeleteAt();
  const webhookIdentity = getDiscordBotWebhookIdentity(speaker.tenantId, speaker.botName);
  const botAvatar = firstUrl(
    webhookIdentity.avatarUrl,
    await getAvatarUrlForTenant(speaker.tenantId),
    SPACEMOUNTAIN_FALLBACK_LOGO,
  );
  const owner = await resolveTenantOwnerBranding(speaker.tenantId);
  const requesterLogo = firstUrl(input.sourceUserAvatarUrl, SPACEMOUNTAIN_FALLBACK_LOGO);

  const embed = await buildDiscordBotEmbed({
    description: input.message,
    tenantId: speaker.tenantId,
    botName: speaker.botName,
    title: input.title,
    responseType: input.responseType,
    sourceMessage: input.sourceMessage,
    sourceUser: input.sourceUser,
    sourceUserAvatarUrl: requesterLogo,
    deleteAt: deleteAt || undefined,
    mediaSlot: input.isPrivate ? 'private' : 'public',
    includeConfiguredMedia: Boolean(input.isPrivate),
    imageUrl: input.imageUrl,
    thumbnailUrl: firstUrl(input.thumbnailUrl, botAvatar),
    color: input.color,
    fields: input.fields,
  });

  embed.author = {
    ...embed.author,
    name: `Bot owned by ${owner.name}`,
    icon_url: firstUrl(owner.logo, SPACEMOUNTAIN_FALLBACK_LOGO),
  };
  embed.thumbnail = { url: firstUrl(input.thumbnailUrl, botAvatar, SPACEMOUNTAIN_FALLBACK_LOGO) };
  embed.footer = {
    ...embed.footer,
    icon_url: requesterLogo,
  };

  return {
    content: '',
    embeds: [
      input.embedUrl ? { ...embed, url: input.embedUrl } : embed,
      ...(input.extraEmbeds || []),
    ],
    username: webhookIdentity.username,
    deleteAt,
    speaker,
  };
}

export async function sendStructuredDiscordReply(input: StructuredDiscordReplyInput): Promise<{ messageId?: string; deleteAt: string; speaker: DiscordReplySpeaker }> {
  const payload = await buildStructuredDiscordReplyPayload(input);
  const { deleteAt, speaker } = payload;
  const webhookIdentity = getDiscordBotWebhookIdentity(speaker.tenantId, speaker.botName);
  const avatarUrl = firstUrl(
    webhookIdentity.avatarUrl,
    await getAvatarUrlForTenant(speaker.tenantId),
    SPACEMOUNTAIN_FALLBACK_LOGO,
  );

  const botTokenPayload = {
    content: '',
    embeds: payload.embeds,
    ...(input.components?.length ? { components: input.components } : {}),
  };

  let sent: any;
  try {
    sent = input.isPrivate || input.components?.length || (!speaker.tenantId && !input.tenantId)
      ? await sendDiscordEmbed(input.channelId, botTokenPayload)
      : await sendWebhookMessage(input.channelId, input.message, webhookIdentity.username, avatarUrl, payload.embeds);
  } catch (error) {
    console.warn('[Discord Reply] Webhook reply failed; retrying through the bot-token embed route:', error);
    sent = await sendDiscordEmbed(input.channelId, botTokenPayload);
  }

  const sentId = typeof sent?.id === 'string' ? sent.id : '';

  if (sentId && input.isPrivate) {
    try {
      const controlledEmbeds = attachPrivateDmControls(payload.embeds, {
        channelId: input.channelId,
        messageId: sentId,
      });
      await editDiscordMessage(input.channelId, sentId, {
        embeds: controlledEmbeds,
        ...(input.components?.length ? { components: input.components } : {}),
      });
    } catch (error) {
      // Never suppress the actual DM response because the optional icon strip
      // could not be attached. The reply itself remains usable.
      console.warn('[Discord Reply] Failed to attach private emoji controls:', error);
    }
  }

  if (sentId && input.sourceMessageId && !input.isPrivate) {
    await deleteMessage(input.channelId, input.sourceMessageId).catch(() => {});
  }

  if (!input.isPrivate) {
    await recordDiscordMessageCleanup({
      tenantId: speaker.tenantId || input.tenantId,
      channelId: input.channelId,
      triggerMessageId: sentId ? input.sourceMessageId : undefined,
      replyMessageIds: [sentId],
      replyMessages: [input.message],
      sourceUser: input.sourceUser,
      botName: speaker.botName,
      triggerMessage: input.sourceMessage,
    }).catch(() => {});
  }

  return {
    messageId: sentId || undefined,
    deleteAt,
    speaker,
  };
}
