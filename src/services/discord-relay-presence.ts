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

export async function lookupDiscordRelayPresence(userIdInput: string, guildIdInput?: string): Promise<DiscordRelayPresence | null> {
  const userId = String(userIdInput || '').trim();
  const guildId = String(guildIdInput || '').trim();
  const secret = getDshSecret();
  if (!userId || !secret) return null;

  const url = new URL(`${getDshUrl()}/api/discord/relay-presence`);
  url.searchParams.set('userId', userId);
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
      console.warn(`[RelayPresence] DSH lookup failed ${response.status} for Discord user ${userId}`);
      return null;
    }
    const value = await response.json().catch(() => null) as any;
    if (!value || value.found !== true) return null;
    const preferredChannelId = String(value.preferredChannelId || '').trim() || null;
    return {
      found: true,
      userId: String(value.userId || userId).trim(),
      guildId: String(value.guildId || guildId).trim() || undefined,
      username: String(value.username || '').trim() || undefined,
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
