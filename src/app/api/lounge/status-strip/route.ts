import { SPACEMOUNTAIN_LOUNGE_SESSION_ID } from '@/lib/spacemountain-lounge';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const CHAT_TAG_URL = String(process.env.CHAT_TAG_BASE_URL || process.env.NEXT_PUBLIC_CHAT_TAG_URL || 'https://chat-tag-new.fly.dev').replace(/\/+$/, '');
const SPOTLIGHT_URL = String(process.env.DSH_COMMUNITY_SPOTLIGHT_URL || 'https://discord-stream-hub-new.fly.dev/api/community-spotlight');
const EVENTS_URL = String(process.env.DSH_COMMUNITY_EVENTS_URL || 'https://discord-stream-hub-new.fly.dev/api/community-events');
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

async function loungeState() {
  const response = await fetch(`${HEARMEOUT_URL}/api/watch/sessions/${encodeURIComponent(SPACEMOUNTAIN_LOUNGE_SESSION_ID)}/state`, {
    cache: 'no-store',
    headers: { Accept: 'application/json' },
    signal: typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(8_000) : undefined,
  });
  if (!response.ok) throw new Error(`HearMeOut Lounge returned ${response.status}`);
  return response.json();
}

export async function GET() {
  const [gameResult, spotlightResult, mediaResult, eventsResult] = await Promise.allSettled([
    json(`${CHAT_TAG_URL}/api/game-hub/channel?channel=spacemountainlive`),
    json(SPOTLIGHT_URL),
    loungeState(),
    json(EVENTS_URL),
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
  const mediaState = mediaResult.status === 'fulfilled' ? mediaResult.value : null;
  const mediaItem = mediaState?.current?.item || null;
  const eventPayload = eventsResult.status === 'fulfilled' ? eventsResult.value : {};
  const events = (Array.isArray(eventPayload?.events) ? eventPayload.events : [])
    .filter((event: any) => event?.title && Number.isFinite(Date.parse(String(event?.startsAt || ''))))
    .slice(0, 3)
    .map((event: any) => ({
      id: String(event.id || ''),
      title: String(event.title).trim(),
      startsAt: String(event.startsAt),
    }));
  return NextResponse.json({
    events,
    games,
    spotlight: login ? {
      login,
      displayName: String(source?.displayName || user?.displayName || login).trim(),
      avatarUrl: String(source?.profileImageUrl || source?.profile_image_url || user?.profileImageUrl || user?.profile_image_url || user?.avatarUrl || '').trim(),
    } : null,
    media: mediaItem ? {
      kind: mediaItem?.type === 'movie' ? 'movie' : 'music',
      title: String(mediaItem?.title || mediaItem?.name || 'Untitled media').trim(),
      thumbnailUrl: String(mediaItem?.thumbnailUrl || mediaItem?.thumbnail || '').trim(),
    } : null,
  }, { headers: { 'cache-control': 'no-store, no-cache, must-revalidate' } });
}
