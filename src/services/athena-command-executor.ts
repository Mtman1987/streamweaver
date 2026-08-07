import type { AthenaRequest } from '@/services/athena-contract';

export type AthenaCommandExecution = {
  executed: boolean;
  delivered: boolean;
  detail: string;
};

function actorName(request: AthenaRequest): string {
  return request.actor.displayName || request.actor.username || 'AthenaUser';
}

async function executeDiscord(request: AthenaRequest, command: string): Promise<AthenaCommandExecution> {
  const channelId = String(request.location.channelId || '').trim();
  if (!channelId) {
    return { executed: false, delivered: false, detail: 'Discord command requires a channelId in the trusted location context.' };
  }
  const { handleDiscordMessage } = await import('@/services/chat-dispatcher');
  const result = await handleDiscordMessage({
    channelId,
    channel_id: channelId,
    guildId: request.location.guildId,
    guild_id: request.location.guildId,
    content: command,
    message: command,
    id: request.location.messageId || `athena-${Date.now()}`,
    messageId: request.location.messageId || `athena-${Date.now()}`,
    isDM: request.location.surface === 'discord-dm',
    isDirectMessage: request.location.surface === 'discord-dm',
    isOwner: request.actor.isOwner === true,
    isMod: request.actor.isModerator === true || request.actor.isAdmin === true,
    author: {
      id: request.actor.userId,
      username: request.actor.username,
      globalName: actorName(request),
      global_name: actorName(request),
      bot: false,
    },
  }, request.tenantId, {
    skipAiMentions: true,
    skipPublicHistory: request.visibility === 'private',
    skipTwitchBridge: request.visibility === 'private',
    replyMode: 'structured',
  });
  return {
    executed: result.commandHandled,
    delivered: result.commandHandled,
    detail: result.commandHandled
      ? `Discord dispatcher handled ${command}.`
      : `Discord dispatcher did not recognize or authorize ${command}.`,
  };
}

async function executeTwitch(request: AthenaRequest, command: string): Promise<AthenaCommandExecution> {
  const channel = String(request.location.channelName || request.location.channelId || '').trim().replace(/^#/, '');
  if (!channel) {
    return { executed: false, delivered: false, detail: 'Twitch command requires a channelName in the trusted location context.' };
  }
  const { handleTwitchMessage } = await import('@/services/chat-dispatcher');
  await handleTwitchMessage(`#${channel}`, {
    id: request.actor.userId,
    username: request.actor.username,
    'display-name': actorName(request),
    mod: request.actor.isModerator === true || request.actor.isAdmin === true,
    badges: request.actor.isOwner ? { broadcaster: '1' } : {},
  }, command, false);
  return {
    executed: true,
    delivered: true,
    detail: `Twitch dispatcher received ${command} for #${channel}.`,
  };
}

async function executeKick(request: AthenaRequest, command: string): Promise<AthenaCommandExecution> {
  const { handleKickMessage } = await import('@/services/chat-dispatcher');
  await handleKickMessage({
    id: request.location.messageId || `athena-${Date.now()}`,
    username: request.actor.username,
    displayName: actorName(request),
    message: command,
    timestamp: new Date(),
    badges: [],
    isSubscriber: false,
    isModerator: request.actor.isModerator === true || request.actor.isAdmin === true,
    isOwner: request.actor.isOwner === true,
  }, request.tenantId);
  return {
    executed: true,
    delivered: true,
    detail: `Kick dispatcher received ${command}.`,
  };
}

export async function executeAthenaTransportCommand(request: AthenaRequest, command: string): Promise<AthenaCommandExecution> {
  if (!command.trim().startsWith('!')) {
    return { executed: false, delivered: false, detail: 'Transport commands must begin with !.' };
  }
  if (request.location.surface === 'discord-channel' || request.location.surface === 'discord-dm') {
    return executeDiscord(request, command);
  }
  if (request.location.surface === 'twitch-chat') return executeTwitch(request, command);
  if (request.location.surface === 'kick-chat') return executeKick(request, command);
  return {
    executed: false,
    delivered: false,
    detail: `The ${request.location.surface} surface does not have a transport command dispatcher.`,
  };
}
