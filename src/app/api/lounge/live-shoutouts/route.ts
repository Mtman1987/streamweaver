import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const SPMT_URL = String(process.env.SPMT_BASE_URL || 'https://spmt.live').replace(/\/+$/, '');

function text(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function rowsFrom(payload: any): any[] {
  const data = payload?.data && typeof payload.data === 'object' ? payload.data : payload;
  if (Array.isArray(data?.liveMembers)) return data.liveMembers;
  return [data?.shoutouts, data?.items, data?.rows, data?.community]
    .find((value) => Array.isArray(value)) || [];
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
    const response = await fetch(`${SPMT_URL}/api/community/shoutouts`, {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      signal: typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(8_000) : undefined,
    });
    if (!response.ok) throw new Error(`SPMT live feed returned ${response.status}`);
    const payload = await response.json().catch(() => ({}));
    const creators = rowsFrom(payload)
      .filter((row) => row && (row.isLive === true || row.live === true || String(row.status || '').toLowerCase() === 'live'))
      .filter((row) => group === 'partner' ? isPriorityCreator(row) : !isPriorityCreator(row))
      .map((row) => ({
        username: text(row.twitchUsername, row.username, row.login),
        displayName: text(row.twitchDisplayName, row.displayName, row.name, row.twitchUsername, row.username, row.login) || 'Live creator',
        avatarUrl: text(row.profileImageUrl, row.profile_image_url, row.avatarUrl, row.avatar_url, row.logoUrl, row.logo),
        gameName: text(row.gameName, row.game_name, row.game, row.categoryName, row.category),
        title: text(row.title, row.streamTitle, row.stream_title),
        viewerCount: Math.max(0, Number(row.viewerCount ?? row.viewer_count ?? row.viewers ?? 0) || 0),
        group: group === 'partner' ? 'Partner / Crew' : 'Community',
      }))
      .filter((creator) => creator.username || creator.displayName);

    return NextResponse.json({ group, creators }, { headers: { 'cache-control': 'no-store, no-cache, must-revalidate' } });
  } catch (error) {
    console.warn('[LoungeLiveShoutouts] feed unavailable:', error);
    return NextResponse.json({ group, creators: [], error: 'Live community feed unavailable' }, {
      status: 200,
      headers: { 'cache-control': 'no-store, no-cache, must-revalidate' },
    });
  }
}
