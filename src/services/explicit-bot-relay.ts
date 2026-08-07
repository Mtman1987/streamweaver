import { getBotPersonality } from '@/lib/bot-settings-store';
import { readDiscordConfig } from '@/lib/discord-config';
import type { WorldLoreCharacter } from '@/lib/world-lore-store';
import { sendDiscordMessage } from '@/services/discord';
import { findDiscordLastSeenForNames } from '@/services/discord-last-seen';
import { lookupDiscordStreamHubTwitchTarget } from '@/services/discord-stream-hub';
import { requestAthenaModel } from '@/services/athena-model';
import { getTenantBroadcasterChannel } from '@/services/tenant-chat-routing';
import { sendChatMessage } from '@/services/twitch';

export type ExplicitBotRelayMode = 'live' | 'discord' | 'dm';

export type ExplicitBotRelayResult = {
  delivered: boolean;
  mode?: ExplicitBotRelayMode;
  message?: string;
  targetChannel?: string;
  error?: string;
};

export type ExplicitBotRelayInput = {
  sourceTenantId: string;
  sourceUserName: string;
  speaker: WorldLoreCharacter;
  targetTenantId: string;
  target: WorldLoreCharacter;
  relayMessage: string;
};

export type ExplicitBotRelayDependencies = {
  getBroadcasterChannel?: (tenantId: string) => Promise<string>;
  lookupLiveTarget?: (channel: string) => Promise<any>;
  sendTwitch?: (message: string, as: 'bot' | 'broadcaster', channel?: string, tenantId?: string) => Promise<any>;
  findDiscordLastSeen?: (names: string[]) => Promise<any>;
  readTargetDiscordConfig?: (tenantId: string) => Promise<any>;
  sendDiscord?: (channelId: string, message: string, username?: string) => Promise<any>;
  generateRelayText?: (input: ExplicitBotRelayInput & { targetAudienceName: string }) => Promise<string>;
};

function cleanRelayMessage(value: unknown): string {
  return String(value || '')
    .replace(/^\s*(?:that|to)\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 2_000);
}

function cleanModelReply(value: string, targetName: string): string {
  const escaped = targetName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return String(value || '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(new RegExp(`^${escaped}:\\s*`, 'i'), '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);
}

export async function generateExplicitBotRelayText(
  input: ExplicitBotRelayInput & { targetAudienceName: string },
): Promise<string> {
  const relayMessage = cleanRelayMessage(input.relayMessage);
  const targetPersonality = String(getBotPersonality(input.targetTenantId) || '').trim();
  const fallback = `Hey boss, ${input.speaker.currentName} wanted me to let you know ${relayMessage}`.replace(/\s+/g, ' ').trim();
  if (!relayMessage) return fallback;

  try {
    const completion = await requestAthenaModel({
      messages: [
        {
          role: 'system',
          content: [
            `You are ${input.target.currentName}, the configured tenant bot for ${input.targetAudienceName}.`,
            input.target.archetype ? `Archetype: ${input.target.archetype}.` : '',
            input.target.summary || '',
            input.target.personalityNotes?.length ? input.target.personalityNotes.join(' ') : '',
            targetPersonality ? `Tenant personality: ${targetPersonality}` : '',
            'Deliver one explicit human-requested relay in one short natural sentence.',
            'Say that the source bot wanted the target streamer to know the message. Preserve the meaning and any time estimate.',
            'Do not mention APIs, automation, memory stores, botshare, or internal routing.',
            'Do not invent that anyone replied or completed an action.',
          ].filter(Boolean).join('\n'),
        },
        {
          role: 'user',
          content: [
            `Source human: ${input.sourceUserName}.`,
            `Source bot: ${input.speaker.currentName}.`,
            `Target streamer/chat: ${input.targetAudienceName}.`,
            `Message to relay: ${relayMessage}`,
          ].join('\n'),
        },
      ],
      temperature: 0.45,
      maxTokens: 220,
    });
    return cleanModelReply(completion.text, input.target.currentName) || fallback;
  } catch (error) {
    console.warn('[Explicit Bot Relay] Local phrasing failed; using deterministic relay text', error);
    return fallback;
  }
}

export async function deliverExplicitBotRelay(
  input: ExplicitBotRelayInput,
  dependencies: ExplicitBotRelayDependencies = {},
): Promise<ExplicitBotRelayResult> {
  const relayMessage = cleanRelayMessage(input.relayMessage);
  if (!input.sourceTenantId || !input.targetTenantId || !relayMessage) {
    return { delivered: false, error: 'Source tenant, target tenant, and relay message are required.' };
  }

  const getBroadcasterChannel = dependencies.getBroadcasterChannel || getTenantBroadcasterChannel;
  const lookupLiveTarget = dependencies.lookupLiveTarget || lookupDiscordStreamHubTwitchTarget;
  const sendTwitch = dependencies.sendTwitch || sendChatMessage;
  const findDiscordLastSeen = dependencies.findDiscordLastSeen || findDiscordLastSeenForNames;
  const readTargetDiscordConfig = dependencies.readTargetDiscordConfig || readDiscordConfig;
  const sendDiscord = dependencies.sendDiscord || sendDiscordMessage;
  const generateRelayText = dependencies.generateRelayText || generateExplicitBotRelayText;

  const broadcasterChannel = String(await getBroadcasterChannel(input.targetTenantId) || '').replace(/^#/, '').trim();
  if (!broadcasterChannel) {
    return { delivered: false, error: `No broadcaster channel is configured for ${input.target.currentName}.` };
  }

  const relayText = await generateRelayText({ ...input, relayMessage, targetAudienceName: broadcasterChannel });
  const liveTarget = await lookupLiveTarget(broadcasterChannel).catch(() => null);

  if (liveTarget?.isLive === true) {
    try {
      await sendTwitch(relayText, 'bot', broadcasterChannel, input.targetTenantId);
      return {
        delivered: true,
        mode: 'live',
        message: relayText,
        targetChannel: broadcasterChannel,
      };
    } catch (error) {
      console.warn('[Explicit Bot Relay] Live Twitch delivery failed; trying Discord fallback', error);
    }
  }

  const lookupNames = Array.from(new Set([
    broadcasterChannel,
    input.target.currentName,
    ...(input.target.aliases || []),
    ...(input.target.previousNames || []),
  ].map((value) => String(value || '').trim()).filter(Boolean)));

  try {
    const lastSeen = await findDiscordLastSeen(lookupNames);
    const channelId = String(lastSeen?.channelId || '').trim();
    if (channelId) {
      await sendDiscord(channelId, relayText, input.target.currentName);
      return {
        delivered: true,
        mode: 'discord',
        message: relayText,
        targetChannel: channelId,
      };
    }
  } catch (error) {
    console.warn('[Explicit Bot Relay] Discord last-seen delivery failed; trying configured DM', error);
  }

  try {
    const config = await readTargetDiscordConfig(input.targetTenantId);
    const dmChannelId = String(config?.dmChannelId || '').trim();
    if (dmChannelId) {
      await sendDiscord(dmChannelId, relayText, input.target.currentName);
      return {
        delivered: true,
        mode: 'dm',
        message: relayText,
        targetChannel: dmChannelId,
      };
    }
  } catch (error) {
    console.warn('[Explicit Bot Relay] Configured DM delivery failed', error);
  }

  return {
    delivered: false,
    message: relayText,
    error: `${input.target.currentName} is not live and has no reachable Discord channel or DM route.`,
  };
}
