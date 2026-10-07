import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const CHAT_TAG_URL = String(process.env.CHAT_TAG_BASE_URL || process.env.NEXT_PUBLIC_CHAT_TAG_URL || 'https://chat-tag-new.fly.dev').replace(/\/+$/, '');
const SPOTLIGHT_URL = String(process.env.DSH_COMMUNITY_SPOTLIGHT_URL || 'https://discord-stream-hub-new.fly.dev/api/community-spotlight');
const EVENTS_URL = String(process.env.DSH_COMMUNITY_EVENTS_URL || 'https://discord-stream-hub-new.fly.dev/api/community-events');
const LOUNGE_WORKER_URL = String(process.env.HMO_LOUNGE_WORKER_URL || 'https://hmo-dj-worker.fly.dev:4444').replace(/\/+$/, '');

async function json(url: string): Promise<any> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  // Bound both headers and body parsing independently of fetch's abort support.
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error('Status source deadline exceeded'));
      controller.abort();
    }, 2_000);
  });
  try {
    return await Promise.race([
      (async () => {
        const response = await fetch(url, {
          cache: 'no-store',
          headers: { Accept: 'application/json' },
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`Status source returned ${response.status}`);
        return response.json();
      })(),
      deadline,
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function loungeState() {
  return json(`${LOUNGE_WORKER_URL}/lounge/media/program`);
}

async function buildStatusStrip() {
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
  const active = mediaState?.movie?.current && mediaState.movie.playback?.status === 'playing' ? mediaState.movie : mediaState?.music;
  const mediaItem = active?.current?.item || null;
  const eventPayload = eventsResult.status === 'fulfilled' ? eventsResult.value : {};
  const events = (Array.isArray(eventPayload?.events) ? eventPayload.events : [])
    .filter((event: any) => event?.title && Number.isFinite(Date.parse(String(event?.startsAt || ''))))
    .slice(0, 3)
    .map((event: any) => ({
      id: String(event.id || ''),
      title: String(event.title).trim(),
      startsAt: String(event.startsAt),
    }));
  return {
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
  };
}

// Several mounted lounge widgets request this strip together. Share the same
// four upstream lookups for a short window instead of multiplying them on
// every poll and competing with chat and Fly health checks. Upstream deadlines
// must leave room inside the diagnostic caller's eight-second request budget.
let cached: { at: number; value: Awaited<ReturnType<typeof buildStatusStrip>> } | null = null;
let pending: Promise<Awaited<ReturnType<typeof buildStatusStrip>>> | null = null;

export async function GET() {
  if (!cached || Date.now() - cached.at >= 2500) {
    if (!pending) {
      pending = buildStatusStrip().then((value) => {
        cached = { at: Date.now(), value };
        return value;
      }).finally(() => { pending = null; });
    }
    // Serve recent display data while a slow optional source refreshes. The
    // cache contains public display metadata, never permissions or credentials.
    if (!cached || Date.now() - cached.at >= 30_000) await pending;
    else void pending.catch(() => {});
  }
  return NextResponse.json(cached!.value, {
    headers: { 'cache-control': 'no-store, no-cache, must-revalidate' },
  });
}

