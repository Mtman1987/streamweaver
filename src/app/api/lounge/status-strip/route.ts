import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const CHAT_TAG_URL = String(process.env.CHAT_TAG_BASE_URL || process.env.NEXT_PUBLIC_CHAT_TAG_URL || 'https://chat-tag-new.fly.dev').replace(/\/+$/, '');
const SPOTLIGHT_URL = String(process.env.DSH_COMMUNITY_SPOTLIGHT_URL || 'https://discord-stream-hub-new.fly.dev/api/community-spotlight');

async function json(url: string): Promise<any> {
  const response = await fetch(url, {
    cache: 'no-store',
    headers: { Accept: 'application/json' },
    signal: typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(8_000) : undefined,
  });
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response.json();
}

export async function GET() {
  const [gameResult, spotlightResult] = await Promise.allSettled([
    json(`${CHAT_TAG_URL}/api/game-hub/channel?channel=spacemountainlive`),
    json(SPOTLIGHT_URL),
  ]);
  const gamePayload = gameResult.status === 'fulfilled' ? gameResult.value : {};
  const spotlightPayload = spotlightResult.status === 'fulfilled' ? spotlightResult.value : {};
  const source = spotlightPayload?.spotlight || {};
  const user = source?.user || {};
  const games = (Array.isArray(gamePayload?.games) ? gamePayload.games : []).map((game: any) => ({
    id: String(game?.id || ''),
    name: String(game?.shortName || game?.name || game?.id || 'Active game'),
    command: String(game?.commandKey || game?.id || ''),
  }));
  const login = String(source?.twitchLogin || user?.twitchLogin || user?.login || '').replace(/^@/, '').trim();
  return NextResponse.json({
    games,
    spotlight: login ? {
      login,
      displayName: String(source?.displayName || user?.displayName || login).trim(),
      avatarUrl: String(source?.profileImageUrl || source?.profile_image_url || user?.profileImageUrl || user?.profile_image_url || user?.avatarUrl || '').trim(),
    } : null,
  }, { headers: { 'cache-control': 'no-store, no-cache, must-revalidate' } });
}
