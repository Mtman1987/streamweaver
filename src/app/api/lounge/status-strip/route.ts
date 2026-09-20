import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const CHAT_TAG_URL = String(process.env.CHAT_TAG_BASE_URL || process.env.NEXT_PUBLIC_CHAT_TAG_URL || 'https://chat-tag-new.fly.dev').replace(/\/+$/, '');
const SPOTLIGHT_URL = String(process.env.DSH_COMMUNITY_SPOTLIGHT_URL || 'https://discord-stream-hub-new.fly.dev/api/community-spotlight');
const HEARMEOUT_URL = String(process.env.HEARMEOUT_BASE_URL || process.env.NEXT_PUBLIC_HEARMEOUT_URL || 'https://hearmeout-main.fly.dev').replace(/\/+$/, '');

async function json(url: string): Promise<any> {
  const response = await fetch(url, {
    cache: 'no-store',
    headers: { Accept: 'application/json' },
    signal: typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(8_000) : undefined,
  });
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response.json();
}

async function hearMeOutState(sessionId: 'discord-music-room' | 'discord-watch-room') {
  const response = await fetch(`${HEARMEOUT_URL}/api/internal/bot/actions`, {
    method: 'POST',
    cache: 'no-store',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'hmo.media.state.read',
      tenantId: 'spacemountainlive',
      actorUserId: 'lounge-status-strip',
      actorName: 'Space Mountain Lounge',
      actorRole: 'member',
      sessionId,
    }),
    signal: typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(8_000) : undefined,
  });
  if (!response.ok) throw new Error(`HearMeOut ${sessionId} returned ${response.status}`);
  return response.json();
}

export async function GET() {
  const [gameResult, spotlightResult, musicResult, movieResult] = await Promise.allSettled([
    json(`${CHAT_TAG_URL}/api/game-hub/channel?channel=spacemountainlive`),
    json(SPOTLIGHT_URL),
    hearMeOutState('discord-music-room'),
    hearMeOutState('discord-watch-room'),
  ]);
  const gamePayload = gameResult.status === 'fulfilled' ? gameResult.value : {};
  const spotlightPayload = spotlightResult.status === 'fulfilled' ? spotlightResult.value : {};
  const source = spotlightPayload?.spotlight || {};
  const user = source?.user || {};
  const games = (Array.isArray(gamePayload?.games) ? gamePayload.games : []).map((game: any) => ({
    id: String(game?.id || ''),
    name: String(game?.shortName || game?.name || game?.id || 'Active game'),
    command: String(game?.commandKey || game?.id || ''),
    playerCommands: (Array.isArray(game?.playerCommands) ? game.playerCommands : []).map((command: any) => ({
      trigger: String(command?.trigger || '').trim(),
      description: String(command?.description || '').trim(),
    })).filter((command: any) => command.trigger),
  }));
  const login = String(source?.twitchLogin || user?.twitchLogin || user?.login || '').replace(/^@/, '').trim();
  const mediaCandidates = [
    { kind: 'music' as const, payload: musicResult.status === 'fulfilled' ? musicResult.value : null },
    { kind: 'movie' as const, payload: movieResult.status === 'fulfilled' ? movieResult.value : null },
  ].filter((candidate) => candidate.payload?.session?.current?.item);
  const playingMedia = mediaCandidates.filter((candidate) => candidate.payload?.session?.playback?.status === 'playing');
  const selectedMedia = [...(playingMedia.length ? playingMedia : mediaCandidates)].sort((a, b) =>
    Number(b.payload?.session?.playback?.updatedAt || 0) - Number(a.payload?.session?.playback?.updatedAt || 0),
  )[0] || null;
  const mediaItem = selectedMedia?.payload?.session?.current?.item || null;
  return NextResponse.json({
    games,
    spotlight: login ? {
      login,
      displayName: String(source?.displayName || user?.displayName || login).trim(),
      avatarUrl: String(source?.profileImageUrl || source?.profile_image_url || user?.profileImageUrl || user?.profile_image_url || user?.avatarUrl || '').trim(),
    } : null,
    media: mediaItem ? {
      kind: selectedMedia?.kind,
      title: String(mediaItem?.title || mediaItem?.name || 'Untitled media').trim(),
      thumbnailUrl: String(mediaItem?.thumbnailUrl || mediaItem?.thumbnail || '').trim(),
    } : null,
  }, { headers: { 'cache-control': 'no-store, no-cache, must-revalidate' } });
}
