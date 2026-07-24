export type OpenBotCommand =
  | 'live-members'
  | 'chat-tag-current'
  | 'chat-tag-status'
  | 'chat-tag-leaderboard'
  | 'apps'
  | 'hearmeout'
  | 'help';

type FetchLike = typeof fetch;

const CHAT_TAG_URL = (process.env.CHAT_TAG_BASE_URL || process.env.NEXT_PUBLIC_CHAT_TAG_URL || 'https://chat-tag-new.fly.dev').replace(/\/+$/, '');
const SPMT_URL = (process.env.SPMT_BASE_URL || 'https://spmt.live').replace(/\/+$/, '');
const HEARMEOUT_URL = (process.env.HEARMEOUT_BASE_URL || process.env.NEXT_PUBLIC_HEARMEOUT_URL || 'https://hearmeout-main.fly.dev').replace(/\/+$/, '');

export function detectOpenBotCommand(message: string): OpenBotCommand | null {
  const normalized = String(message || '')
    .toLowerCase()
    .replace(/[’]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

  if (/\b(who(?:'s| is) live|who is streaming|anyone streaming|anyone live|live (?:members|streamers|crew))\b/.test(normalized)) {
    return 'live-members';
  }
  if (/\b(who(?:'s| is) it|who has the tag|current(?:ly)? it)\b/.test(normalized)) {
    return 'chat-tag-current';
  }
  if (/\b(chat[\s-]?tag (?:status|state)|how many (?:chat[\s-]?tag )?players|game status)\b/.test(normalized)) {
    return 'chat-tag-status';
  }
  if (/\b(chat[\s-]?tag (?:leaderboard|rankings?)|top (?:three|3)|who is winning|who's winning)\b/.test(normalized)) {
    return 'chat-tag-leaderboard';
  }
  if (/\b(what|which|list|show)\b.*\b(apps?|tools?)\b|\bwhat can (?:you|i) control\b/.test(normalized)) {
    return 'apps';
  }
  if (/\b(what(?:'s| is) playing|now playing|hearmeout status|hear me out status|what is queued)\b/.test(normalized)) {
    return 'hearmeout';
  }
  if (/\b(open commands|public commands|community commands|what can you do|bot help)\b/.test(normalized)) {
    return 'help';
  }
  return null;
}

export async function runOpenBotCommand(command: OpenBotCommand, fetcher: FetchLike = fetch): Promise<string> {
  if (command === 'help') {
    return [
      'Open commands work even when the streamer is offline:',
      '"who\'s live?", "who\'s it?", "ChatTag status", "top 3",',
      '"what apps can you control?", and "what\'s playing?"',
    ].join(' ');
  }

  if (command === 'live-members') {
    const data = await fetchJson(fetcher, `${CHAT_TAG_URL}/api/discord/live-members`);
    const members = Array.isArray(data.liveMembers) ? data.liveMembers : [];
    if (!members.length) return 'Nobody in the SpaceMountain community is live right now.';
    const names = members
      .map((member: any) => String(member.twitchDisplayName || member.twitchUsername || member.discordDisplayName || '').trim())
      .filter(Boolean);
    const shown = names.slice(0, 12);
    const remaining = Math.max(0, names.length - shown.length);
    return `🟢 ${names.length} live: ${shown.join(', ')}${remaining ? `, and ${remaining} more` : ''}.`;
  }

  if (command === 'apps') {
    const data = await fetchJson(fetcher, `${SPMT_URL}/api/apps`);
    const apps = (Array.isArray(data.apps) ? data.apps : [])
      .filter((app: any) => app?.name)
      .map((app: any) => String(app.name));
    return apps.length
      ? `SpaceMountain apps I know about: ${apps.join(', ')}.`
      : 'The SpaceMountain app catalog is empty right now.';
  }

  if (command === 'hearmeout') {
    const data = await fetchJson(fetcher, `${HEARMEOUT_URL}/api/music/session/state`);
    const current = data.current && typeof data.current === 'object' ? data.current : null;
    const queue = Array.isArray(data.queue) ? data.queue : [];
    if (current?.title) return `🎵 Now playing: ${current.title}${current.artist ? ` by ${current.artist}` : ''}. ${queue.length} queued.`;
    if (queue[0]?.title) return `HearMeOut is idle. Next in the ${queue.length}-item queue: ${queue[0].title}${queue[0].artist ? ` by ${queue[0].artist}` : ''}.`;
    return 'HearMeOut is idle and its queue is empty.';
  }

  const data = await fetchJson(fetcher, `${CHAT_TAG_URL}/api/tag`);
  const players = Array.isArray(data.players) ? data.players : [];
  if (command === 'chat-tag-current') {
    const current = players.find((player: any) => player?.isIt);
    return current
      ? `🏷️ ${current.twitchUsername || current.username || 'Someone'} is currently IT in ChatTag.`
      : '🏷️ ChatTag is currently free-for-all; nobody is IT.';
  }
  if (command === 'chat-tag-status') {
    const active = players.filter((player: any) => player?.isActive).length;
    return `ChatTag has ${players.length} players, with ${active} currently active.`;
  }

  const leaders = [...players]
    .sort((left: any, right: any) => Number(right?.score || 0) - Number(left?.score || 0))
    .slice(0, 3);
  if (!leaders.length) return 'ChatTag does not have any ranked players yet.';
  return `🏆 ChatTag top 3: ${leaders.map((player: any, index) => `#${index + 1} ${player.twitchUsername || player.username || 'unknown'} (${Number(player.score || 0)} pts)`).join(' | ')}.`;
}

async function fetchJson(fetcher: FetchLike, url: string): Promise<any> {
  const response = await fetcher(url, {
    headers: { accept: 'application/json' },
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`Open bot command source failed (${response.status})`);
  return response.json();
}
