import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const DSH_URL = String(process.env.DSH_COMMUNITY_SPOTLIGHT_URL || 'https://discord-stream-hub-new.fly.dev/api/community-spotlight');

function text(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function isPriorityCreator(row: any): boolean {
  if (row?.isPartner === true || row?.isCrew === true || row?.partner === true || row?.crew === true) return true;
  const labels = [row?.group, row?.role, row?.tier, row?.category, row?.membership, ...(Array.isArray(row?.roles) ? row.roles : [])]
    .map((value) => String(value || '').toLowerCase());
  return labels.some((value) => /partner|crew|mountain|moderator|\bmod\b/.test(value));
}

export async function GET(request: NextRequest) {
  const group = request.nextUrl.searchParams.get('group') === 'partner' ? 'partner' : 'community';
  try {
    const response = await fetch(DSH_URL, {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      signal: typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(8_000) : undefined,
    });
    if (!response.ok) throw new Error(`${DSH_URL} returned ${response.status}`);
    const dsh = await response.json().catch(() => ({}));
    const spotlight = dsh?.spotlight || {};
    const rows: any[] = Array.isArray(dsh?.users) ? dsh.users : [];

    const creators = rows
      .filter((row: any) => group === 'partner' ? isPriorityCreator(row) : !isPriorityCreator(row))
      .map((row: any) => {
        const username = text(row.twitchLogin, row.twitchUsername, row.login, row.username);
        const featured = String(spotlight?.twitchLogin || '').toLowerCase() === username.toLowerCase() ? spotlight : {};
        return {
          username,
          displayName: text(row.displayName, row.username, row.twitchDisplayName, username) || 'Live creator',
          avatarUrl: text(featured.avatarUrl, row.avatarUrl, row.profileImageUrl, row.profile_image_url),
          gameName: text(featured.gameTitle, row.gameName, row.game_name),
          title: text(featured.streamTitle, row.streamTitle, row.title),
          viewerCount: Math.max(0, Number(featured.viewerCount ?? row.viewerCount ?? 0) || 0),
          group: group === 'partner' ? 'Partner / Crew' : 'Community',
        };
      })
      .filter((creator: any) => creator.username || creator.displayName);

    return NextResponse.json({ group, creators, source: 'discord-stream-hub' }, {
      headers: { 'cache-control': 'no-store, no-cache, must-revalidate' },
    });
  } catch (error) {
    console.warn('[LoungeLiveShoutouts] DSH feed unavailable:', error);
    return NextResponse.json({ group, creators: [], source: 'discord-stream-hub', error: 'Live community feed unavailable' }, {
      status: 200,
      headers: { 'cache-control': 'no-store, no-cache, must-revalidate' },
    });
  }
}
