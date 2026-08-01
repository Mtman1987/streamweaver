import { listTenants } from '@/lib/tenant';
import { readWorldLore } from '@/lib/world-lore-store';
import { getBotName } from '@/lib/bot-settings-store';
import { deleteMessage } from './discord-local';
import { buildDiscordBotEmbed, buildStreamWeaverLogoUrl, getDiscordBotWebhookIdentity } from './discord-branding';
import { getAvatarUrlForTenant } from './discord-webhook-avatar';
import { recordDiscordMessageCleanup, getDiscordMessageCleanupDeleteAt } from './discord-message-cleanup';
import { sendWebhookMessage } from './discord-webhooks';
import { sendDiscordEmbed, sendDiscordMessage } from './discord-local';

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
  // Extra embeds sharing the main embed's `url` render as a single image gallery.
  extraEmbeds?: Record<string, unknown>[];
  embedUrl?: string;
};

let rotatingSpeakerIndex = 0;

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

  const fallbackBotName = getBotName(fallbackTenantId) || 'StreamWeaver';
  return [{
    botName: fallbackBotName,
    tenantId: fallbackTenantId,
    stableId: `${fallbackTenantId || 'global'}:${fallbackBotName.toLowerCase()}`,
  }];
}

export async function resolveStructuredDiscordReplySpeaker(input: { tenantId?: string; botName?: string; rotateSpeaker?: boolean }): Promise<DiscordReplySpeaker> {
  if (!input.rotateSpeaker) {
    const botName = input.botName || getBotName(input.tenantId) || 'StreamWeaver';
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
    rotateSpeaker: input.rotateSpeaker,
  });
  const deleteAt = getDiscordMessageCleanupDeleteAt();
  const webhookIdentity = getDiscordBotWebhookIdentity(speaker.tenantId, speaker.botName);
  const embed = await buildDiscordBotEmbed({
    description: input.message,
    tenantId: speaker.tenantId,
    botName: speaker.botName,
    title: input.title,
    responseType: input.responseType,
    sourceMessage: input.sourceMessage,
    sourceUser: input.sourceUser,
    sourceUserAvatarUrl: input.sourceUserAvatarUrl,
    deleteAt,
    imageUrl: input.imageUrl,
    thumbnailUrl: input.thumbnailUrl,
    color: input.color,
    fields: input.fields,
  });
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
  const avatarUrl = webhookIdentity.avatarUrl || await getAvatarUrlForTenant(speaker.tenantId) || buildStreamWeaverLogoUrl();

  let sent: any;
  if (!speaker.tenantId && !input.tenantId) {
    sent = await sendDiscordMessage(input.channelId, input.message);
  } else {
    try {
      sent = input.components?.length
        ? await sendDiscordEmbed(input.channelId, {
            content: '',
            embeds: payload.embeds,
            components: input.components,
          })
        : await sendWebhookMessage(input.channelId, input.message, webhookIdentity.username, avatarUrl, payload.embeds);
    } catch (error) {
      console.warn('[Discord Reply] Structured reply failed; falling back to direct Discord message:', error);
      sent = await sendDiscordMessage(input.channelId, input.message);
    }
  }

  const sentId = typeof sent?.id === 'string' ? sent.id : '';

  if (sentId && input.sourceMessageId) {
    await deleteMessage(input.channelId, input.sourceMessageId).catch(() => {});
  }

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

  return {
    messageId: sentId || undefined,
    deleteAt,
    speaker,
  };
}
