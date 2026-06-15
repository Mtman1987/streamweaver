import { getInternalAppUrl } from '@/lib/runtime-origin';
import { buildStreamWeaverLogoUrl } from './discord-branding';
import { sendDiscordEmbed } from './discord-local';
import { getTwitchUser } from './twitch';
import { fetchClip } from './walk-on-shoutout';

type StreamInfo = {
  title: string;
  gameName: string;
  viewerCount: number;
  thumbnailUrl: string;
  isLive: boolean;
};

type DshMediaLookup = {
  found: boolean;
  group?: string;
  isLive?: boolean;
  bannerUrl?: string | null;
  gifUrl?: string | null;
};

function getDiscordStreamHubUrl(): string {
  return (
    process.env.DISCORD_STREAM_HUB_URL ||
    process.env.NEXT_PUBLIC_DISCORD_STREAM_HUB_URL ||
    'https://discord-stream-hub-new.fly.dev'
  ).replace(/\/$/, '');
}

async function getDshMediaLookup(username: string): Promise<DshMediaLookup | null> {
  try {
    const response = await fetch(`${getDiscordStreamHubUrl()}/api/clips/lookup?twitchLogin=${encodeURIComponent(username)}`, {
      cache: 'no-store',
    });
    if (!response.ok) return null;
    return await response.json().catch(() => null);
  } catch {
    return null;
  }
}

async function getAppAccessToken(): Promise<string | null> {
  const clientId = process.env.TWITCH_CLIENT_ID || process.env.NEXT_PUBLIC_TWITCH_CLIENT_ID;
  const clientSecret = process.env.TWITCH_CLIENT_SECRET || process.env.NEXT_PUBLIC_TWITCH_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  const response = await fetch(`https://id.twitch.tv/oauth2/token?client_id=${clientId}&client_secret=${clientSecret}&grant_type=client_credentials`, {
    method: 'POST',
  });
  if (!response.ok) return null;
  const data = await response.json().catch(() => null);
  return typeof data?.access_token === 'string' ? data.access_token : null;
}

async function getStreamInfo(username: string): Promise<StreamInfo | null> {
  const token = await getAppAccessToken();
  const clientId = process.env.TWITCH_CLIENT_ID || process.env.NEXT_PUBLIC_TWITCH_CLIENT_ID;
  if (!token || !clientId) return null;

  const response = await fetch(`https://api.twitch.tv/helix/streams?user_login=${encodeURIComponent(username)}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Client-ID': clientId,
    },
  });
  if (!response.ok) return null;

  const data = await response.json().catch(() => null);
  const stream = data?.data?.[0];
  if (!stream) return null;

  return {
    title: stream.title || '',
    gameName: stream.game_name || '',
    viewerCount: Number(stream.viewer_count || 0),
    thumbnailUrl: String(stream.thumbnail_url || '')
      .replace('{width}', '1920')
      .replace('{height}', '1080'),
    isLive: true,
  };
}

async function getAiShoutout(username: string): Promise<string> {
  try {
    const response = await fetch(`${getInternalAppUrl()}/api/ai/shoutout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username }),
    });
    const data = await response.json().catch(() => null);
    return String(data?.shoutout || data?.data?.shoutout || '').trim();
  } catch {
    return '';
  }
}

export async function buildDiscordCommandShoutoutPayload(input: {
  requesterName: string;
  targetName: string;
}): Promise<{ payload: { embeds: Record<string, unknown>[]; components: Record<string, unknown>[] }; isLive: boolean; twitchLogin: string; }> {
  const username = input.targetName.replace(/^@/, '').trim().toLowerCase();
  if (!username) {
    throw new Error('Missing target username');
  }

  const [user, stream, clip, aiShoutout] = await Promise.all([
    getTwitchUser(username).catch(() => null),
    getStreamInfo(username).catch(() => null),
    fetchClip(username).catch(() => null),
    getAiShoutout(username).catch(() => ''),
  ]);
  const dshMedia = await getDshMediaLookup(username).catch(() => null);

  const displayName = user?.displayName || input.targetName.replace(/^@/, '').trim();
  const twitchUrl = `https://twitch.tv/${username}`;
  const description = aiShoutout || `Go check out ${displayName} on Twitch.`;
  const gameLabel = stream?.gameName || user?.lastGame || 'Unknown';
  const viewerLabel = stream?.isLive ? `${stream.viewerCount}` : 'Offline';
  const mediaUrl =
    dshMedia?.gifUrl ||
    stream?.thumbnailUrl ||
    clip?.thumbnailUrl ||
    user?.profileImageUrl ||
    '';
  const embeds: Record<string, unknown>[] = [];

  if (dshMedia?.bannerUrl) {
    embeds.push({
      image: { url: dshMedia.bannerUrl },
      color: 0x00d9ff,
    });
  }

  const embed = {
    author: {
      name: `${displayName} Community Spotlight`,
      url: twitchUrl,
      icon_url: user?.profileImageUrl || buildStreamWeaverLogoUrl(),
    },
    title: stream?.isLive
      ? `${displayName} is LIVE on Twitch`
      : `Shoutout for ${displayName}`,
    description,
    url: twitchUrl,
    color: 0x00d9ff,
    fields: [
      {
        name: stream?.isLive ? 'Playing' : 'Last Game',
        value: gameLabel || 'Unknown',
        inline: true,
      },
      {
        name: 'Viewers',
        value: viewerLabel,
        inline: true,
      },
      {
        name: 'Spotlight',
        value: `Called by @${input.requesterName}`,
        inline: true,
      },
    ],
    thumbnail: user?.profileImageUrl ? { url: user.profileImageUrl } : undefined,
    image: mediaUrl ? { url: mediaUrl } : undefined,
    footer: {
      text: 'StreamWeaver Discord Shoutout',
      icon_url: buildStreamWeaverLogoUrl(),
    },
    timestamp: new Date().toISOString(),
  };
  embeds.push(embed);

  const buttons: Record<string, unknown>[] = [
    {
      type: 2,
      style: 5,
      label: 'Watch on Twitch',
      url: twitchUrl,
      emoji: { name: '📺' },
    },
  ];

  if (clip?.url) {
    buttons.push({
      type: 2,
      style: 5,
      label: 'Open Clip',
      url: clip.url,
      emoji: { name: '🎬' },
    });
  }

  return {
    payload: {
      embeds,
      components: [
        {
          type: 1,
          components: buttons,
        },
      ],
    },
    isLive: Boolean(stream?.isLive),
    twitchLogin: username,
  };
}

export async function sendDiscordCommandShoutout(input: {
  channelId: string;
  requesterName: string;
  targetName: string;
}): Promise<{ messageId: string | null; isLive: boolean; twitchLogin: string; }> {
  const { payload, isLive, twitchLogin } = await buildDiscordCommandShoutoutPayload(input);
  const sent = await sendDiscordEmbed(input.channelId, payload);
  return {
    messageId: typeof sent?.id === 'string' ? sent.id : null,
    isLive,
    twitchLogin,
  };
}
