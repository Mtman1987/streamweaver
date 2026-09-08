import { createDiscordDmChannel, sendDiscordMessage } from './discord-local';
import { lookupDiscordRelayPresenceByName } from './discord-relay-presence';

function relayText(targetName: string, sourceUserName: string, message: string, userId?: string): string {
  const target = String(targetName || '').replace(/^@/, '').trim();
  const source = String(sourceUserName || '').trim();
  const body = String(message || '').trim();
  const mention = userId ? `<@${userId}> ` : '';
  return `${mention}${target}, ${source} says: ${body}`.trim();
}

export async function deliverDirectHumanRelay(input: {
  targetName: string;
  sourceUserName: string;
  relayMessage: string;
  guildId?: string;
}): Promise<{
  delivered: boolean;
  mode?: 'discord' | 'dm';
  userId?: string;
  channelId?: string;
  error?: string;
}> {
  const presence = await lookupDiscordRelayPresenceByName(input.targetName, input.guildId).catch(() => null);
  const userId = String(presence?.userId || '').trim();
  if (!presence || !userId) {
    return { delivered: false, error: `${input.targetName} was not found in current Discord presence` };
  }

  const message = relayText(input.targetName, input.sourceUserName, input.relayMessage, userId);
  const activeChannelId = String(presence.preferredChannelId || '').trim();

  if (activeChannelId) {
    try {
      await sendDiscordMessage(activeChannelId, message);
      return { delivered: true, mode: 'discord', userId, channelId: activeChannelId };
    } catch (error) {
      console.warn('[DirectHumanRelay] Active Discord channel delivery failed; falling back to DM:', error instanceof Error ? error.message : String(error));
    }
  }

  try {
    const dm = await createDiscordDmChannel(userId);
    await sendDiscordMessage(dm.id, message);
    return { delivered: true, mode: 'dm', userId, channelId: dm.id };
  } catch (error) {
    return {
      delivered: false,
      userId,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
