export type DiscordRelayPresence = {
  found: boolean;
  userId?: string;
  guildId?: string;
  username?: string;
  displayName?: string;
  inVoice: boolean;
  recentlyChatting: boolean;
  preferredKind: 'voice' | 'chat' | null;
  preferredChannelId: string | null;
  preferredChannelName?: string | null;
  lastChatAt?: string;
  voiceObservedAt?: string;
};

function getDshUrl(): string {
  return (
    process.env.DISCORD_STREAM_HUB_URL ||
    process.env.NEXT_PUBLIC_DISCORD_STREAM_HUB_URL ||
    'https://discord-stream-hub-new.fly.dev'
  ).replace(/\/$/, '');
}

function getDshSecret(): string {
  return String(process.env.DSH_SERVICE_SECRET || process.env.DSH_CLIENT_SECRET || process.env.BOT_SECRET_KEY || '').trim();
}

async function lookupDiscordRelayPresenceQuery(input: { userId?: string; username?: string; guildId?: string }): Promise<DiscordRelayPresence | null> {
  const userId = String(input.userId || '').trim();
  const username = String(input.username || '').trim().replace(/^@/, '');
  const guildId = String(input.guildId || '').trim();
  const secret = getDshSecret();
  if ((!userId && !username) || !secret) return null;

  const url = new URL(`${getDshUrl()}/api/discord/relay-presence`);
  if (userId) url.searchParams.set('userId', userId);
  else url.searchParams.set('username', username);
  if (guildId) url.searchParams.set('guildId', guildId);

  try {
    const response = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${secret}` },
      cache: 'no-store',
      signal: typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
        ? AbortSignal.timeout(5_000)
        : undefined,
    });
    if (!response.ok) {
      console.warn(`[RelayPresence] DSH lookup failed ${response.status} for Discord ${userId ? `user ${userId}` : `name ${username}`}`);
      return null;
    }
    const value = await response.json().catch(() => null) as any;
    if (!value || value.found !== true) return null;
    const preferredChannelId = String(value.preferredChannelId || '').trim() || null;
    return {
      found: true,
      userId: String(value.userId || userId).trim() || undefined,
      guildId: String(value.guildId || guildId).trim() || undefined,
      username: String(value.username || username).trim() || undefined,
      displayName: String(value.displayName || '').trim() || undefined,
      inVoice: value.inVoice === true,
      recentlyChatting: value.recentlyChatting === true,
      preferredKind: value.preferredKind === 'voice' || value.preferredKind === 'chat' ? value.preferredKind : null,
      preferredChannelId,
      preferredChannelName: String(value.preferredChannelName || '').trim() || null,
      lastChatAt: String(value.lastChatAt || '').trim() || undefined,
      voiceObservedAt: String(value.voiceObservedAt || '').trim() || undefined,
    };
  } catch (error) {
    console.warn('[RelayPresence] DSH lookup unavailable:', error instanceof Error ? error.message : String(error));
    return null;
  }
}

export async function lookupDiscordRelayPresence(userIdInput: string, guildIdInput?: string): Promise<DiscordRelayPresence | null> {
  return lookupDiscordRelayPresenceQuery({ userId: userIdInput, guildId: guildIdInput });
}

export async function lookupDiscordRelayPresenceByName(usernameInput: string, guildIdInput?: string): Promise<DiscordRelayPresence | null> {
  return lookupDiscordRelayPresenceQuery({ username: usernameInput, guildId: guildIdInput });
}
