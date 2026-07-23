import { getStoredTokens } from '@/lib/token-utils.server';
import { normalizeSayChannel, resolveSayStreamKey } from '@/services/say-tts';
import { normalizeSayQueueTenant } from './_store';

export function canonicalSayStreamKey(streamKey: unknown, broadcasterUsername?: unknown): string {
  const normalized = normalizeSayQueueTenant(streamKey);
  if (normalized === 'global' || /^(discord|twitch):/i.test(normalized)) {
    const [platform, ...channelParts] = normalized.split(':');
    const channel = normalizeSayChannel(channelParts.join(':'));
    return channel
      ? resolveSayStreamKey(undefined, platform.toLowerCase() as 'discord' | 'twitch', channel)
      : normalized;
  }

  const broadcasterChannel = normalizeSayChannel(broadcasterUsername);
  return broadcasterChannel
    ? resolveSayStreamKey(undefined, 'twitch', broadcasterChannel)
    : normalized;
}

export async function resolveSayQueueStreamKey(streamKey: unknown): Promise<string> {
  const normalized = normalizeSayQueueTenant(streamKey);
  if (normalized === 'global' || /^(discord|twitch):/i.test(normalized)) {
    return canonicalSayStreamKey(normalized);
  }

  const tokens = await getStoredTokens(normalized).catch(() => null);
  return canonicalSayStreamKey(normalized, tokens?.broadcasterUsername);
}
