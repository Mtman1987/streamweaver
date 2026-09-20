import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const DSH_URL = String(process.env.DSH_COMMUNITY_SPOTLIGHT_URL || 'https://discord-stream-hub-new.fly.dev/api/community-spotlight');
const CHAT_TAG_URL = String(process.env.CHAT_TAG_BASE_URL || process.env.NEXT_PUBLIC_CHAT_TAG_URL || 'https://chat-tag-new.fly.dev').replace(/\/+$/, '');

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
    const load = async (url: string) => {
      const response = await fetch(url, {
        cache: 'no-store',
        headers: { Accept: 'application/json' },
        signal: typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(8_000) : undefined,
      });
      if (!response.ok) throw new Error(`${url} returned ${response.status}`);
      return response.json().catch(() => ({}));
    };
    const [dshResult, chatTagResult] = await Promise.allSettled([
      load(DSH_URL),
      load(`${CHAT_TAG_URL}/api/discord/live-members`),
    ]);
    const dsh = dshResult.status === 'fulfilled' ? dshResult.value : {};
    const chatTag = chatTagResult.status === 'fulfilled' ? chatTagResult.value : {};
    const currentLiveMembers = Array.isArray(chatTag?.liveMembers) ? chatTag.liveMembers : [];
    const liveDetails = new Map(currentLiveMembers
      .map((row: any) => [String(row?.twitchUsername || '').toLowerCase(), row]));
    const twitchProfiles = new Map((Array.isArray(chatTag?.allMembers) ? chatTag.allMembers : [])
      .map((row: any) => [String(row?.username || '').toLowerCase(), row]));
    const spotlight = dsh?.spotlight || {};
    const dshRows = Array.isArray(dsh?.users) ? dsh.users : [];
    const dshByLogin = new Map(dshRows.map((row: any) => [
      text(row.twitchLogin, row.twitchUsername, row.username, row.login).toLowerCase(),
      row,
    ]));
    // Chat Tag is the current Twitch-live source of truth. DSH enriches those
    // live identities with the saved partner/crew group and Discord avatar.
    // Only fall back to DSH's cached online rows when the live feed is down.
    const rows = chatTagResult.status === 'fulfilled' && Array.isArray(chatTag?.liveMembers)
      ? currentLiveMembers.map((liveRow: any) => {
          const login = text(liveRow.twitchUsername, liveRow.username, liveRow.login);
          return { ...(dshByLogin.get(login.toLowerCase()) || {}), ...liveRow, twitchLogin: login };
        })
      : dshRows;
    if (!rows.length && dshResult.status === 'rejected' && chatTagResult.status === 'rejected') {
      throw new Error('Both live community feeds are unavailable');
    }
    const creators = rows
      .filter((row) => group === 'partner' ? isPriorityCreator(row) : !isPriorityCreator(row))
      .map((row) => {
        const username = text(row.twitchLogin, row.twitchUsername, row.username, row.login);
        const details: any = liveDetails.get(username.toLowerCase()) || {};
        const profile: any = twitchProfiles.get(username.toLowerCase()) || {};
        const featured = String(spotlight?.twitchLogin || '').toLowerCase() === username.toLowerCase() ? spotlight : {};
        return {
          username,
          displayName: text(details.twitchDisplayName, row.displayName, row.username, username) || 'Live creator',
          avatarUrl: text(featured.avatarUrl, profile.profile_image_url, row.avatarUrl, details.avatarUrl),
          gameName: text(featured.gameTitle, details.gameName),
          title: text(featured.streamTitle, details.streamTitle),
          viewerCount: Math.max(0, Number(featured.viewerCount ?? details.viewerCount ?? 0) || 0),
          group: group === 'partner' ? 'Partner / Crew' : 'Community',
        };
      })
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
