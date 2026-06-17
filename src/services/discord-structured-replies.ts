import { listTenants } from '@/lib/tenant';
import { readWorldLore } from '@/lib/world-lore-store';
import { getBotName } from '@/lib/bot-settings-store';
import { deleteMessage } from './discord-local';
import { buildDiscordBotEmbed, getDiscordBotProfileAvatarUrl, getDiscordBotWebhookIdentity } from './discord-branding';
import { getAvatarUrlForTenant } from './discord-webhook-avatar';
import { recordDiscordMessageCleanup, getDiscordMessageCleanupDeleteAt } from './discord-message-cleanup';
import { sendWebhookMessage } from './discord-webhooks';

export type DiscordReplySpeaker = {
  botName: string;
  tenantId?: string;
  stableId: string;
};

type StructuredDiscordReplyInput = {
  channelId: string;
  message: string;
  tenantId?: string;
  botName?: string;
  rotateSpeaker?: boolean;
  speaker?: DiscordReplySpeaker;
  sourceMessageId?: string;
  sourceMessage?: string;
  sourceUser?: string;
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

export async function sendStructuredDiscordReply(input: StructuredDiscordReplyInput): Promise<{ messageId?: string; deleteAt: string; speaker: DiscordReplySpeaker }> {
  const speaker = input.speaker || await resolveStructuredDiscordReplySpeaker({
    tenantId: input.tenantId,
    botName: input.botName,
    rotateSpeaker: input.rotateSpeaker,
  });
  const deleteAt = getDiscordMessageCleanupDeleteAt();
  const webhookIdentity = getDiscordBotWebhookIdentity(speaker.tenantId, speaker.botName);
  const avatarUrl = webhookIdentity.avatarUrl || await getDiscordBotProfileAvatarUrl() || await getAvatarUrlForTenant(speaker.tenantId);
  const embed = await buildDiscordBotEmbed({
    description: input.message,
    tenantId: speaker.tenantId,
    botName: speaker.botName,
    deleteAt,
  });
  const sent = await sendWebhookMessage(input.channelId, input.message, webhookIdentity.username, avatarUrl, [embed]);

  if (input.sourceMessageId) {
    await deleteMessage(input.channelId, input.sourceMessageId).catch(() => {});
  }

  await recordDiscordMessageCleanup({
    tenantId: speaker.tenantId || input.tenantId,
    channelId: input.channelId,
    replyMessageIds: [sent?.id || ''],
    replyMessages: [input.message],
    sourceUser: input.sourceUser,
    botName: speaker.botName,
    triggerMessage: input.sourceMessage,
  }).catch(() => {});

  return {
    messageId: sent?.id,
    deleteAt,
    speaker,
  };
}
