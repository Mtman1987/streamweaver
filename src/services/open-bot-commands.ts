import { generateAIResponse } from '@/services/ai-provider';

export type OpenBotCommand =
  | 'live-members'
  | 'chat-tag-current'
  | 'chat-tag-status'
  | 'chat-tag-leaderboard'
  | 'apps'
  | 'hearmeout'
  | 'help';

type FetchLike = typeof fetch;
type AiResponder = typeof generateAIResponse;
type FetchJsonOptions = {
  method?: RequestInit['method'];
  body?: BodyInit | null;
  headers?: HeadersInit;
  serviceSecrets?: string[];
};

const CHAT_TAG_URL = (process.env.CHAT_TAG_BASE_URL || process.env.NEXT_PUBLIC_CHAT_TAG_URL || 'https://chat-tag-new.fly.dev').replace(/\/+$/, '');
const SPMT_URL = (process.env.SPMT_BASE_URL || 'https://spmt.live').replace(/\/+$/, '');
const HEARMEOUT_URL = (process.env.HEARMEOUT_BASE_URL || process.env.NEXT_PUBLIC_HEARMEOUT_URL || 'https://hearmeout-main.fly.dev').replace(/\/+$/, '');

function normalizeSpmtCommandTypos(command: string): string {
  return command
    .replace(/\b(?:sttus|staus|stauts|statsu|statuz)\b/g, 'status')
    .replace(/\b(?:liv|lve)\b/g, 'live');
}

function detectExplicitSpmtCommand(normalized: string): OpenBotCommand | null {
  const match = normalized.match(/^@?spmt(?:\s+|[:,-]\s*)(.+)$/);
  if (!match) return null;

  const command = normalizeSpmtCommandTypos(match[1].trim());
  if (/^(?:status|state|game status|chat[\s-]?tag status)$/.test(command)) return 'chat-tag-status';
  if (/^(?:current|tag|who(?:'?s| is) it|who has the tag)$/.test(command)) return 'chat-tag-current';
  if (/^(?:leader|leaderboard|rankings?|top(?:\s+(?:3|three))?)$/.test(command)) return 'chat-tag-leaderboard';
  if (/^(?:live|who(?:'?s| is) live|streamers?|members live)$/.test(command)) return 'live-members';
  if (/^(?:apps?|tools?|catalog)$/.test(command)) return 'apps';
  if (/^(?:hearmeout|hear me out|music|now playing|queue)$/.test(command)) return 'hearmeout';
  if (/^(?:help|commands?|command list)$/.test(command)) return 'help';
  return null;
}

/**
 * Converts an explicit SPMT namespace command into the existing native command
 * syntax. The DM route only uses this after the safe read-only command catalog
 * declines the request, so `spmt status` stays a Chat Tag lookup while
 * `spmt points`, `spmt checkin`, and other installed commands reuse the normal
 * command dispatcher.
 */
export function rewriteSpmtNamespaceCommand(message: string): string | null {
  const match = String(message || '').trim().match(/^@?spmt(?:\s+|[:,-]\s*)(.+)$/i);
  if (!match) return null;
  const command = match[1].trim().replace(/^!+/, '');
  return command ? `!${command}` : null;
}

export function detectOpenBotCommand(message: string): OpenBotCommand | null {
  const raw = String(message || '').trim();
  // Explicit !commands belong to the native Discord/Twitch command dispatcher.
  // Never let the natural-language classifier reinterpret !leader or !points.
  if (raw.startsWith('!')) return null;

  const normalized = raw
    .toLowerCase()
    .replace(/[’]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

  // SPMT-prefixed commands are an explicit command namespace. In particular,
  // Discord DMs must execute these before the conversational Athena path.
  const explicitSpmtCommand = detectExplicitSpmtCommand(normalized);
  if (explicitSpmtCommand) return explicitSpmtCommand;

  if (
    /\b(who(?:'?s| is) live|who is streaming|anyone streaming|anyone live|live (?:members|streamers|crew))\b/.test(normalized) ||
    /\bhow many\b.*\b(?:users?|members?|people|creators?|streamers?)\b.*\b(?:live|streaming|broadcasting)\b/.test(normalized) ||
    /\bhow many\b.*\b(?:live|streaming|broadcasting)\b.*\b(?:users?|members?|people|creators?|streamers?)\b/.test(normalized) ||
    /\bchat[\s-]?tag\b.*\b(?:users?|members?|people|creators?|streamers?)\b.*\b(?:live|streaming|broadcasting)\b/.test(normalized)
  ) return 'live-members';
  if (/\b(who(?:'s| is) it|who has the tag|current(?:ly)? it)\b/.test(normalized)) return 'chat-tag-current';
  if (/\b(chat[\s-]?tag (?:status|state)|how many (?:chat[\s-]?tag )?players|game status)\b/.test(normalized)) return 'chat-tag-status';
  if (/\b(chat[\s-]?tag (?:leaderboard|rankings?)|top (?:three|3)|who is winning|who's winning)\b/.test(normalized)) return 'chat-tag-leaderboard';
  if (/\b(what|which|list|show)\b.*\b(apps?|tools?)\b|\bwhat can (?:you|i) control\b/.test(normalized)) return 'apps';
  if (/\b(what(?:'s| is) playing|now playing|hearmeout status|hear me out status|what is queued)\b/.test(normalized)) return 'hearmeout';
  if (/\b(open commands|public commands|community commands|what can you do|bot help)\b/.test(normalized)) return 'help';
  return null;
}

const OPEN_COMMAND_CATALOG: Array<{ command: OpenBotCommand; meaning: string; examples: string[] }> = [
  { command: 'live-members', meaning: 'List SpaceMountain community members who are live or streaming now.', examples: ["who's live?", 'is anybody streaming?', 'show me the live crew'] },
  { command: 'chat-tag-current', meaning: 'Say who is currently IT in the ChatTag game.', examples: ["who's it?", 'who has the tag?', 'which player is currently it?'] },
  { command: 'chat-tag-status', meaning: 'Give the current ChatTag player and activity counts.', examples: ['ChatTag status', 'how many people play ChatTag?', 'is the game active?'] },
  { command: 'chat-tag-leaderboard', meaning: 'List the highest-ranked ChatTag players.', examples: ['show the ChatTag leaderboard', 'who is winning?', 'give me the top three'] },
  { command: 'apps', meaning: 'List the apps and tools available in the SpaceMountain ecosystem.', examples: ['what apps are there?', 'which tools can you control?', 'show the app catalog'] },
  { command: 'hearmeout', meaning: 'Report what HearMeOut is playing now and what is queued.', examples: ["what's playing?", 'what is in the HearMeOut queue?', 'music status'] },
  { command: 'help', meaning: 'Explain the safe public commands this bot can perform.', examples: ['what can you do?', 'show public commands', 'bot help'] },
];

export async function detectOpenBotCommandWithAi(message: string, tenantId?: string, aiResponder: AiResponder = generateAIResponse): Promise<OpenBotCommand | null> {
  const transcript = String(message || '').replace(/\s+/g, ' ').trim().slice(0, 1000);
  if (!transcript || transcript.startsWith('!')) return null;

  const exact = detectOpenBotCommand(transcript);
  if (exact) return exact;

  try {
    const response = await aiResponder(
      [
        `Human message: ${transcript}`,
        '',
        'Available actions:',
        ...OPEN_COMMAND_CATALOG.map((entry) => `${entry.command}: ${entry.meaning}\nExamples: ${entry.examples.join(' | ')}`),
      ].join('\n'),
      [
        'You are the MountainView action router, not the conversational bot.',
        'Infer what the human wants from meaning and context; wording never has to match an example.',
        'Polite or indirect requests to look up current information still count as actions.',
        'For example, asking which of our people are broadcasting means live-members.',
        'Choose only from the supplied safe public action IDs.',
        'If this is ordinary conversation, outside the catalog, or genuinely ambiguous, choose none.',
        'Do not answer the human and do not explain.',
        'Return exactly one action ID or the word none.',
      ].join(' '),
      tenantId,
      { maxTokens: 300, temperature: 0 },
    );
    const parsed = extractJsonObject(response);
    const parsedCommand = String(parsed?.command || '').trim().toLowerCase();
    const normalizedResponse = String(response || '').trim().toLowerCase();
    let command = OPEN_COMMAND_CATALOG.find((entry) =>
      parsedCommand === entry.command || new RegExp(`(^|[^a-z0-9-])${escapeRegExp(entry.command)}([^a-z0-9-]|$)`).test(normalizedResponse)
    )?.command || null;
    if (!command && normalizedResponse.length >= 4) {
      const prefixMatches = OPEN_COMMAND_CATALOG.filter((entry) => entry.command.startsWith(normalizedResponse));
      if (prefixMatches.length === 1) command = prefixMatches[0].command;
    }
    console.log(`[OpenBotCommands] ${JSON.stringify({ tenantId: tenantId || null, command, classifierResponse: normalizedResponse.slice(0, 100) })}`);
    return command;
  } catch (error) {
    console.warn('[OpenBotCommands] Natural-language action routing failed:', error);
    return null;
  }
}

export async function runOpenBotCommand(command: OpenBotCommand, fetcher: FetchLike = fetch): Promise<string> {
  if (command === 'help') {
    return [
      'Private commands work even when the streamer is offline:',
      '`spmt status`, `spmt live`, `spmt current`, `spmt leaderboard`, `spmt apps`, and `spmt music`.',
      'You can also write a read-only request naturally, such as “Athena, how many Chat Tag users are live?”',
      'For any other installed command, use `spmt <command>` in a DM.',
    ].join(' ');
  }

  if (command === 'live-members') {
    const data = await fetchChatTagLiveMembers(fetcher);
    const members = Array.isArray(data.liveMembers) ? data.liveMembers : [];
    if (!members.length) return 'Nobody in the SpaceMountain community is live right now.';
    const names = members.map((member: any) => String(member.twitchDisplayName || member.displayName || member.twitchUsername || member.username || member.discordDisplayName || '').trim()).filter(Boolean);
    const shown = names.slice(0, 12);
    const remaining = Math.max(0, names.length - shown.length);
    return `🟢 ${names.length} live: ${shown.join(', ')}${remaining ? `, and ${remaining} more` : ''}.`;
  }

  if (command === 'apps') {
    const data = await fetchJson(fetcher, `${SPMT_URL}/api/apps`);
    const apps = (Array.isArray(data.apps) ? data.apps : []).filter((app: any) => app?.name).map((app: any) => String(app.name));
    return apps.length ? `SpaceMountain apps I know about: ${apps.join(', ')}.` : 'The SpaceMountain app catalog is empty right now.';
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
    return current ? `🏷️ ${current.twitchUsername || current.username || 'Someone'} is currently IT in ChatTag.` : '🏷️ ChatTag is currently free-for-all; nobody is IT.';
  }
  if (command === 'chat-tag-status') {
    const active = players.filter((player: any) => player?.isActive).length;
    return `ChatTag has ${players.length} players, with ${active} currently active.`;
  }

  const leaders = [...players].sort((left: any, right: any) => Number(right?.score || 0) - Number(left?.score || 0)).slice(0, 3);
  if (!leaders.length) return 'ChatTag does not have any ranked players yet.';
  return `🏆 ChatTag top 3: ${leaders.map((player: any, index) => `#${index + 1} ${player.twitchUsername || player.username || 'unknown'} (${Number(player.score || 0)} pts)`).join(' | ')}.`;
}

function getChatTagServiceSecrets(): string[] {
  return Array.from(new Set([
    process.env.CHAT_TAG_BOT_SECRET,
    process.env.CHAT_TAG_SERVICE_SECRET,
    process.env.DSH_SERVICE_SECRET,
    process.env.DSH_CLIENT_SECRET,
    process.env.BOT_SECRET_KEY,
    process.env.STREAMWEAVER_SECRET,
    process.env.STREAMWEAVER_CLIENT_SECRET,
  ].map((value) => String(value || '').trim()).filter(Boolean)));
}

async function fetchChatTagLiveMembers(fetcher: FetchLike): Promise<any> {
  try {
    return await fetchJson(fetcher, `${CHAT_TAG_URL}/api/discord/live-members`, {
      serviceSecrets: getChatTagServiceSecrets(),
    });
  } catch (error) {
    console.warn('[OpenBotCommands] Protected Chat Tag live lookup failed; using public Twitch fallback:', error);
  }

  const roster = await fetchJson(fetcher, `${CHAT_TAG_URL}/api/tag`);
  const usernames = Array.from(new Set(
    (Array.isArray(roster.players) ? roster.players : [])
      .map((player: any) => String(player?.twitchUsername || player?.username || '').trim().toLowerCase())
      .filter(Boolean),
  ));
  if (!usernames.length) return { liveMembers: [] };

  const liveData = await fetchJson(fetcher, `${CHAT_TAG_URL}/api/twitch/live`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ usernames }),
  });
  return {
    liveMembers: Array.isArray(liveData.liveUsers) ? liveData.liveUsers : [],
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractJsonObject(text: string): any | null {
  const raw = String(text || '').trim();
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  const candidate = fenced || raw;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(candidate.slice(start, end + 1)); } catch { return null; }
}

async function fetchJson(fetcher: FetchLike, url: string, options: FetchJsonOptions = {}): Promise<any> {
  const serviceSecrets = Array.isArray(options.serviceSecrets)
    ? options.serviceSecrets.map((value) => String(value || '').trim()).filter(Boolean)
    : [];
  const attempts = serviceSecrets.length ? serviceSecrets : [''];
  let lastStatus = 0;

  for (const secret of attempts) {
    const signal = typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
      ? AbortSignal.timeout(5000)
      : undefined;
    const headers = new Headers(options.headers || {});
    headers.set('accept', 'application/json');
    if (secret) headers.set('x-bot-secret', secret);

    const response = await fetcher(url, {
      method: options.method || 'GET',
      headers,
      body: options.body,
      cache: 'no-store',
      signal,
    });
    if (response.ok) return response.json();

    lastStatus = response.status;
    if (response.status !== 401 && response.status !== 403) break;
  }

  throw new Error(`Open bot command source failed (${lastStatus || 'request-error'})`);
}
