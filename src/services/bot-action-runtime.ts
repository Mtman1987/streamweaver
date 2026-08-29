import { generateAIResponse } from '@/services/ai-provider';
import { readDiscordConfig } from '@/lib/discord-config';
import {
  executeDiscordStreamHubBotAction,
  getDiscordStreamHubDefaultGuildId,
  type DiscordStreamHubBotAction,
} from '@/services/discord-stream-hub';
import {
  detectDiscordAdminCalendarCommand,
  formatDiscordAdminCalendarEvent,
} from '@/services/discord-admin-calendar-command';
import {
  executeHearMeOutBotAction,
  type HearMeOutBotAction,
} from '@/services/hearmeout-actions';

export type BotActionSource = 'discord' | 'twitch' | 'kick' | 'mountainview' | 'hearmeout' | 'spmt';
export type BotActorRole = 'guest' | 'member' | 'moderator' | 'admin' | 'owner';
export type BotActionRisk = 'read' | 'write' | 'broadcast' | 'destructive';

export type BotActionId = DiscordStreamHubBotAction | HearMeOutBotAction;

export type BotActionDescriptor = {
  id: BotActionId;
  title: string;
  app: 'Discord Stream Hubs' | 'HearMeOut';
  risk: BotActionRisk;
  minimumRole: BotActorRole;
  examples: string[];
};

export type BotActionRequest = {
  action: BotActionId;
  args: Record<string, string>;
  detection: 'explicit' | 'ai';
};

export type BotActionContext = {
  tenantId: string;
  botName: string;
  source: BotActionSource;
  message: string;
  requestId?: string;
  guildId?: string;
  roomId?: string;
  actor: {
    userId?: string;
    username?: string;
    displayName?: string;
    role: BotActorRole;
  };
};

export type BotActionOutcome = {
  handled: true;
  action: BotActionId;
  status: 'completed' | 'needs_input' | 'forbidden' | 'failed';
  response: string;
  result?: Record<string, unknown>;
};

export type BotActionRuntimeDependencies = {
  readDiscordConfig: typeof readDiscordConfig;
  getDiscordStreamHubDefaultGuildId: typeof getDiscordStreamHubDefaultGuildId;
  executeDiscordStreamHubBotAction: typeof executeDiscordStreamHubBotAction;
  executeHearMeOutBotAction: typeof executeHearMeOutBotAction;
};

const DEFAULT_DEPENDENCIES: BotActionRuntimeDependencies = {
  readDiscordConfig,
  getDiscordStreamHubDefaultGuildId,
  executeDiscordStreamHubBotAction,
  executeHearMeOutBotAction,
};

export const BOT_ACTION_CATALOG: readonly BotActionDescriptor[] = [
  {
    id: 'dsh.shoutouts.active.read',
    title: 'Read the Discord Stream Hubs shoutout list',
    app: 'Discord Stream Hubs', risk: 'read', minimumRole: 'member',
    examples: ['read the DSH shoutout list', 'show the active shoutouts'],
  },
  {
    id: 'dsh.shoutouts.live.read',
    title: 'Read which DSH shoutout members are live',
    app: 'Discord Stream Hubs', risk: 'read', minimumRole: 'member',
    examples: ["who's live in DSH?", 'read the live shoutouts'],
  },
  {
    id: 'dsh.calendar.read',
    title: 'Read the DSH Admin Calendar',
    app: 'Discord Stream Hubs', risk: 'read', minimumRole: 'member',
    examples: ["what's on the DSH Admin Calendar?", 'read the admin calendar'],
  },
  {
    id: 'dsh.calendar.captain.read',
    title: "Read the Captain's Log schedule",
    app: 'Discord Stream Hubs', risk: 'read', minimumRole: 'member',
    examples: ["who has Captain's Log?", "read the Captain's Log dates"],
  },
  {
    id: 'dsh.calendar.captain.create',
    title: "Claim a Captain's Log date",
    app: 'Discord Stream Hubs', risk: 'write', minimumRole: 'member',
    examples: ["put me on Captain's Log tomorrow", "claim Captain's Log for 2026-09-02"],
  },
  {
    id: 'dsh.calendar.event.create',
    title: 'Create a DSH Admin Calendar event',
    app: 'Discord Stream Hubs', risk: 'write', minimumRole: 'admin',
    examples: ['add an event to the DSH Admin Calendar titled "record video" for 3 AM UTC September 1st 2026'],
  },
  {
    id: 'dsh.calendar.deploy',
    title: 'Deploy the Admin Calendar to a Discord channel',
    app: 'Discord Stream Hubs', risk: 'broadcast', minimumRole: 'admin',
    examples: ['deploy the admin calendar to #storage'],
  },
  {
    id: 'dsh.calendar.refresh',
    title: 'Refresh the deployed Admin Calendar message',
    app: 'Discord Stream Hubs', risk: 'write', minimumRole: 'admin',
    examples: ['refresh the deployed admin calendar'],
  },
  {
    id: 'dsh.applications.read',
    title: 'Read DSH applications',
    app: 'Discord Stream Hubs', risk: 'read', minimumRole: 'admin',
    examples: ['read the pending mod applications', 'show partner applications'],
  },
  {
    id: 'dsh.applications.deploy',
    title: 'Deploy the mod and partner application embeds',
    app: 'Discord Stream Hubs', risk: 'broadcast', minimumRole: 'admin',
    examples: ['deploy the mod and partner applications to #storage'],
  },
  {
    id: 'hmo.media.state.read',
    title: 'Read what HearMeOut is playing and queued',
    app: 'HearMeOut', risk: 'read', minimumRole: 'member',
    examples: ["what's playing in HearMeOut?", 'read the HearMeOut queue'],
  },
  {
    id: 'hmo.media.request',
    title: 'Request a song, story, audiobook, or other audio in HearMeOut',
    app: 'HearMeOut', risk: 'write', minimumRole: 'member',
    examples: ['play the song "Space Oddity" in HearMeOut', 'queue a story called The Tell-Tale Heart'],
  },
  {
    id: 'hmo.media.control',
    title: 'Control HearMeOut playback and its queue',
    app: 'HearMeOut', risk: 'write', minimumRole: 'moderator',
    examples: ['pause HearMeOut', 'skip the current song', 'clear the HearMeOut queue'],
  },
] as const;

const DESCRIPTORS = new Map(BOT_ACTION_CATALOG.map((entry) => [entry.id, entry]));
const ROLE_LEVEL: Record<BotActorRole, number> = { guest: 0, member: 1, moderator: 2, admin: 3, owner: 4 };

function clean(value: unknown, max = 500): string {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function normalized(message: string): string {
  return clean(message, 5000).toLowerCase().replace(/[’]/g, "'");
}

function extractChannel(message: string): string {
  return clean(message.match(/(?:to|in|into|on)\s+#([a-z0-9_-]{1,100})\b/i)?.[1], 100);
}

function isoDate(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

function extractDate(message: string, now = new Date()): string {
  const explicit = message.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (explicit) return explicit[0];
  const dayOffset = /\btomorrow\b/i.test(message) ? 1 : /\btoday\b/i.test(message) ? 0 : null;
  if (dayOffset !== null) {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + dayOffset));
    return isoDate(date);
  }
  const monthNames: Record<string, number> = {
    january: 0, jan: 0, february: 1, feb: 1, march: 2, mar: 2, april: 3, apr: 3,
    may: 4, june: 5, jun: 5, july: 6, jul: 6, august: 7, aug: 7, september: 8,
    sep: 8, sept: 8, october: 9, oct: 9, november: 10, nov: 10, december: 11, dec: 11,
  };
  const monthDate = message.match(/\b(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sept?|october|oct|november|nov|december|dec)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,)?\s+(20\d{2})\b/i);
  if (!monthDate) return '';
  return isoDate(new Date(Date.UTC(Number(monthDate[3]), monthNames[monthDate[1].toLowerCase()], Number(monthDate[2]))));
}

function extractMediaQuery(message: string): string {
  const quoted = message.match(/["“]([^"”]{1,500})["”]/)?.[1];
  if (quoted) return clean(quoted, 500);
  const match = message.match(/\b(?:play|queue|request|put\s+on|add)\s+(?:(?:the|a|an)\s+)?(?:(?:song|track|music|story|audiobook|audio)\s+)?(?:(?:called|named|titled)\s+)?(.+?)\s*$/i);
  if (!match) return '';
  const query = clean(match[1], 500)
    .replace(/\s+(?:on|in|through)\s+(?:hearmeout|hear\s+me\s+out)\b.*$/i, '')
    .replace(/^(?:on|in|through)\s+(?:hearmeout|hear\s+me\s+out)\b.*$/i, '')
    .replace(/\s+please$/i, '')
    .trim();
  return /^(?:a|an|the)?\s*(?:song|track|music|story|audiobook|audio|something)$/i.test(query) ? '' : query;
}

function detectExplicitAction(message: string): BotActionRequest | null {
  const value = normalized(message);
  const channel = extractChannel(message);

  if (/\b(?:clear|empty)\b.*\b(?:hearmeout|hear\s+me\s+out|music)?\s*queue\b/.test(value)) {
    return { action: 'hmo.media.control', args: { control: 'clear' }, detection: 'explicit' };
  }
  if (/\b(?:skip|next)\b.*\b(?:song|track|story|audio|hearmeout|hear\s+me\s+out)\b|\b(?:hearmeout|hear\s+me\s+out)\b.*\b(?:skip|next)\b/.test(value)) {
    return { action: 'hmo.media.control', args: { control: 'next' }, detection: 'explicit' };
  }
  if (/\bpause\b.*\b(?:music|song|track|story|audio|hearmeout|hear\s+me\s+out)\b|\b(?:hearmeout|hear\s+me\s+out)\b.*\bpause\b/.test(value)) {
    return { action: 'hmo.media.control', args: { control: 'pause' }, detection: 'explicit' };
  }
  if (/\b(?:resume|continue)\b.*\b(?:music|song|track|story|audio|hearmeout|hear\s+me\s+out)\b|\b(?:hearmeout|hear\s+me\s+out)\b.*\b(?:resume|continue)\b/.test(value)) {
    return { action: 'hmo.media.control', args: { control: 'play' }, detection: 'explicit' };
  }
  if (/\bunmute\b.*\b(?:hearmeout|hear\s+me\s+out|music|audio)\b/.test(value)) {
    return { action: 'hmo.media.control', args: { control: 'unmute' }, detection: 'explicit' };
  }
  if (/\bmute\b.*\b(?:hearmeout|hear\s+me\s+out|music|audio)\b/.test(value)) {
    return { action: 'hmo.media.control', args: { control: 'mute' }, detection: 'explicit' };
  }
  const volume = value.match(/\b(?:set|change|turn)\b.*\b(?:hearmeout|hear\s+me\s+out|music|audio)?\s*volume\b.*?\b(\d{1,3})\b/);
  if (volume) return { action: 'hmo.media.control', args: { control: 'volume', value: volume[1] }, detection: 'explicit' };
  if (/\b(?:play|queue|request|put\s+on|add)\b.*\b(?:song|track|music|story|audiobook|audio|hearmeout|hear\s+me\s+out)\b/.test(value)) {
    return { action: 'hmo.media.request', args: { query: extractMediaQuery(message) }, detection: 'explicit' };
  }
  if (/\b(?:what(?:'s| is)|read|show|list|check)\b.*\b(?:playing|queued?|hearmeout|hear\s+me\s+out)\b/.test(value)) {
    return { action: 'hmo.media.state.read', args: {}, detection: 'explicit' };
  }

  const calendarEvent = detectDiscordAdminCalendarCommand(message);
  if (calendarEvent.matched) {
    if (!calendarEvent.event) {
      return { action: 'dsh.calendar.event.create', args: { parseError: calendarEvent.error || 'The event details are incomplete.' }, detection: 'explicit' };
    }
    return {
      action: 'dsh.calendar.event.create',
      detection: 'explicit',
      args: {
        missionName: calendarEvent.event.missionName,
        missionDescription: calendarEvent.event.missionDescription || '',
        missionDate: calendarEvent.event.missionDate,
        missionTime: calendarEvent.event.missionTime,
        missionTimeZone: calendarEvent.event.missionTimeZone,
      },
    };
  }

  if (/\b(?:deploy|post|publish|send)\b.*\b(?:mod(?:erator)?|partner)\b.*\bapplications?\b/.test(value)) {
    return { action: 'dsh.applications.deploy', args: { channel }, detection: 'explicit' };
  }
  if (/\b(?:deploy|post|publish|send)\b.*\b(?:admin\s+)?calendar\b/.test(value)) {
    return { action: 'dsh.calendar.deploy', args: { channel }, detection: 'explicit' };
  }
  if (/\b(?:refresh|update|regenerate)\b.*\b(?:deployed\s+)?(?:admin\s+)?calendar\b/.test(value)) {
    return { action: 'dsh.calendar.refresh', args: {}, detection: 'explicit' };
  }
  if (/\b(?:claim|schedule|set|put|add|sign)\b.*\bcaptain'?s?\s+log\b|\bcaptain'?s?\s+log\b.*\b(?:for me|me on|me for)\b/.test(value)) {
    return { action: 'dsh.calendar.captain.create', args: { selectedDate: extractDate(message) }, detection: 'explicit' };
  }
  if (/\b(?:who|read|show|list|check|what)\b.*\bcaptain'?s?\s+log\b/.test(value)) {
    return { action: 'dsh.calendar.captain.read', args: {}, detection: 'explicit' };
  }
  if (/\b(?:read|show|list|check|what(?:'s| is))\b.*\b(?:dsh|discord\s*stream\s*hubs?)\b.*\b(?:admin\s+)?calendar\b|\b(?:read|show|list|check|what(?:'s| is))\b.*\badmin\s+calendar\b/.test(value)) {
    return { action: 'dsh.calendar.read', args: {}, detection: 'explicit' };
  }
  if (/\b(?:read|show|list|check)\b.*\b(?:pending\s+)?(?:mod(?:erator)?|partner)?\s*applications?\b/.test(value)) {
    const type = /\bpartner\b/.test(value) ? 'partner' : /\bmod(?:erator)?\b/.test(value) ? 'moderator' : '';
    const status = /\bpending\b/.test(value) ? 'pending' : '';
    return { action: 'dsh.applications.read', args: { type, status }, detection: 'explicit' };
  }
  if (/\b(?:who(?:'s| is)|read|show|list|check)\b.*\blive\b.*\b(?:dsh|shoutouts?)\b|\b(?:live\s+shoutouts?|shoutouts?\s+live)\b/.test(value)) {
    return { action: 'dsh.shoutouts.live.read', args: {}, detection: 'explicit' };
  }
  if (/\b(?:read|show|list|check)\b.*\b(?:dsh|discord\s*stream\s*hubs?)?\s*shoutouts?\s+list\b|\b(?:read|show|list)\b.*\bactive\s+shoutouts?\b/.test(value)) {
    return { action: 'dsh.shoutouts.active.read', args: {}, detection: 'explicit' };
  }
  return null;
}

export async function detectBotAction(
  message: string,
  tenantId?: string,
  aiResponder: typeof generateAIResponse = generateAIResponse,
): Promise<BotActionRequest | null> {
  const explicit = detectExplicitAction(message);
  if (explicit) return explicit;

  const value = normalized(message);
  if (!/\b(?:read|show|list|check|what|who)\b/.test(value) || !/\b(?:dsh|discord\s*stream\s*hubs?|calendar|shoutouts?|applications?|captain'?s?\s+log|hearmeout|hear\s+me\s+out|music|queue)\b/.test(value)) {
    return null;
  }

  const aiSafeCatalog = BOT_ACTION_CATALOG.filter((entry) => entry.risk === 'read');
  try {
    const response = await aiResponder(
      [
        `Human message: ${clean(message, 1000)}`,
        '',
        ...aiSafeCatalog.map((entry) => `${entry.id}: ${entry.title}. Examples: ${entry.examples.join(' | ')}`),
      ].join('\n'),
      'Classify this request as one supplied read-only action. Return exactly the action ID, or none. Never choose a write, broadcast, or destructive action.',
      tenantId,
      { maxTokens: 80, temperature: 0 },
    );
    const answer = normalized(response);
    const match = aiSafeCatalog.find((entry) => answer === entry.id || answer.includes(entry.id));
    return match ? { action: match.id, args: {}, detection: 'ai' } : null;
  } catch (error) {
    console.warn('[BotActionRuntime] read-only classification failed:', error);
    return null;
  }
}

function hasRole(actual: BotActorRole, minimum: BotActorRole): boolean {
  return ROLE_LEVEL[actual] >= ROLE_LEVEL[minimum];
}

function formatDate(value: unknown): string {
  const date = new Date(String(value || ''));
  if (Number.isNaN(date.getTime())) return clean(value, 80) || 'unknown date';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  }).format(date);
}

function formatResult(action: BotActionId, result: Record<string, any>): string {
  if (action === 'hmo.media.state.read') {
    const session = result.session || {};
    const current = session.current?.item || null;
    const queue = Array.isArray(session.queue) ? session.queue : [];
    if (current?.title) return `🎵 HearMeOut is playing **${clean(current.title, 160)}**. ${queue.length} item${queue.length === 1 ? '' : 's'} queued.`;
    if (queue[0]?.item?.title) return `HearMeOut is idle. Next in the ${queue.length}-item queue: **${clean(queue[0].item.title, 160)}**.`;
    return 'HearMeOut is idle and its queue is empty.';
  }
  if (action === 'hmo.media.request') return `✅ ${clean(result.message, 500) || 'Queued the HearMeOut request.'}`;
  if (action === 'hmo.media.control') return `✅ HearMeOut ${clean(result.control, 40)} completed.`;
  if (action.startsWith('dsh.shoutouts.')) {
    const rows = Array.isArray(result.shoutouts) ? result.shoutouts : [];
    if (!rows.length) return action.endsWith('.live.read') ? 'No one on the DSH shoutout list is live right now.' : 'The DSH shoutout list is empty.';
    const shown = rows.slice(0, 15).map((row: any) => `${row.isLive ? '🟢' : '⚪'} ${clean(row.username || row.twitchLogin, 100)}`);
    return `DSH shoutouts (${rows.length}): ${shown.join(', ')}${rows.length > shown.length ? `, and ${rows.length - shown.length} more` : ''}.`;
  }
  if (action === 'dsh.calendar.read' || action === 'dsh.calendar.captain.read') {
    const rows = Array.isArray(result.events) ? result.events : [];
    if (!rows.length) return action.endsWith('.captain.read') ? "There are no Captain's Log dates scheduled." : 'The DSH Admin Calendar has no scheduled events.';
    const shown = rows.slice(0, 10).map((row: any) => `${clean(row.eventName, 120)} — ${formatDate(row.eventDateTime)}`);
    return `${action.endsWith('.captain.read') ? "Captain's Log" : 'DSH Admin Calendar'} (${rows.length}): ${shown.join(' | ')}${rows.length > shown.length ? ` | and ${rows.length - shown.length} more` : ''}.`;
  }
  if (action === 'dsh.applications.read') {
    const rows = Array.isArray(result.applications) ? result.applications : [];
    if (!rows.length) return 'No matching DSH applications were found.';
    const shown = rows.slice(0, 12).map((row: any) => `${clean(row.username || row.userId, 100)} (${clean(row.type, 40) || 'application'}: ${clean(row.status, 40)})`);
    return `DSH applications (${rows.length}): ${shown.join(', ')}${rows.length > shown.length ? `, and ${rows.length - shown.length} more` : ''}.`;
  }
  if (action === 'dsh.calendar.event.create') {
    return `✅ Added **${clean(result.eventName || result.missionName, 160) || 'the event'}** to the DSH Admin Calendar.`;
  }
  if (action === 'dsh.calendar.captain.create') return `✅ ${clean(result.message, 500) || "Captain's Log date claimed."}`;
  if (action === 'dsh.calendar.deploy') return `✅ Deployed the DSH Admin Calendar to #${clean(result.channel?.name, 100) || clean(result.channelId, 64)}.`;
  if (action === 'dsh.calendar.refresh') return '✅ Refreshed the deployed DSH Admin Calendar.';
  if (action === 'dsh.applications.deploy') return `✅ Deployed the mod and partner application embeds to #${clean(result.channel?.name, 100) || clean(result.channelId, 64)}.`;
  return '✅ Action completed.';
}

async function resolveDshScope(context: BotActionContext, dependencies: BotActionRuntimeDependencies) {
  const config = await dependencies.readDiscordConfig(context.tenantId);
  const serverId = clean(context.guildId || config.guildId, 64) || await dependencies.getDiscordStreamHubDefaultGuildId();
  const actorUserId = context.source === 'discord'
    ? clean(context.actor.userId, 64)
    : hasRole(context.actor.role, 'admin')
      ? clean(config.discordUserId, 64)
      : '';
  return { serverId, actorUserId };
}

export async function executeBotAction(
  request: BotActionRequest,
  context: BotActionContext,
  dependencies: BotActionRuntimeDependencies = DEFAULT_DEPENDENCIES,
): Promise<BotActionOutcome> {
  const descriptor = DESCRIPTORS.get(request.action);
  if (!descriptor) {
    return { handled: true, action: request.action, status: 'failed', response: 'That bot action is not installed.' };
  }
  if (!context.tenantId) {
    return { handled: true, action: request.action, status: 'failed', response: 'I could not resolve which tenant bot should perform that action.' };
  }
  if (!hasRole(context.actor.role, descriptor.minimumRole)) {
    return {
      handled: true,
      action: request.action,
      status: 'forbidden',
      response: `${context.botName} cannot perform that action for this account. ${descriptor.minimumRole} access is required.`,
    };
  }
  if (request.args.parseError) {
    return { handled: true, action: request.action, status: 'needs_input', response: request.args.parseError };
  }
  if ((request.action === 'dsh.calendar.deploy' || request.action === 'dsh.applications.deploy') && !request.args.channel) {
    return { handled: true, action: request.action, status: 'needs_input', response: 'Tell me the Discord channel, such as `#storage`.' };
  }
  if (request.action === 'dsh.calendar.captain.create' && !request.args.selectedDate) {
    return { handled: true, action: request.action, status: 'needs_input', response: "Tell me the Captain's Log date, including the year, or say today or tomorrow." };
  }
  if (request.action === 'hmo.media.request' && !request.args.query) {
    return { handled: true, action: request.action, status: 'needs_input', response: 'Tell me which song, story, audiobook, or audio you want HearMeOut to play.' };
  }
  if (request.action === 'hmo.media.request' && !context.roomId) {
    return {
      handled: true,
      action: request.action,
      status: 'needs_input',
      response: 'Private song playback handoff is not enabled yet, so I did not put this in a public HearMeOut queue. Open a HearMeOut room for room-scoped playback.',
    };
  }

  try {
    if (request.action.startsWith('hmo.')) {
      const result = await dependencies.executeHearMeOutBotAction({
        action: request.action as HearMeOutBotAction,
        tenantId: context.tenantId,
        roomId: context.roomId,
        actorUserId: context.actor.userId,
        actorName: context.actor.displayName || context.actor.username,
        query: request.args.query,
        control: request.args.control,
        value: request.args.value ? Number(request.args.value) : undefined,
        idempotencyKey: clean(context.requestId, 160) || undefined,
      });
      return { handled: true, action: request.action, status: 'completed', response: formatResult(request.action, result), result };
    }
    const { serverId, actorUserId } = await resolveDshScope(context, dependencies);
    if ((request.action === 'dsh.calendar.captain.create' || request.action === 'dsh.calendar.event.create') && !actorUserId) {
      return {
        handled: true,
        action: request.action,
        status: 'needs_input',
        response: `Link a Discord identity to ${context.botName}'s tenant before creating DSH calendar entries from ${context.source}.`,
      };
    }
    const result = await dependencies.executeDiscordStreamHubBotAction({
      action: request.action as DiscordStreamHubBotAction,
      serverId,
      actorUserId,
      channel: request.args.channel,
      selectedDate: request.args.selectedDate,
      missionName: request.args.missionName,
      missionDescription: request.args.missionDescription || (context.actor.displayName ? `Added by ${context.actor.displayName} through ${context.source}.` : `Added through ${context.source}.`),
      missionDate: request.args.missionDate,
      missionTime: request.args.missionTime,
      missionTimeZone: request.args.missionTimeZone,
      status: request.args.status,
      type: request.args.type,
      idempotencyKey: clean(context.requestId, 160) || undefined,
    });
    const enriched = request.action === 'dsh.calendar.event.create'
      ? { ...result, eventName: request.args.missionName, formattedDate: formatDiscordAdminCalendarEvent(request.args as any) }
      : result;
    return { handled: true, action: request.action, status: 'completed', response: formatResult(request.action, enriched), result: enriched };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[BotActionRuntime:${context.tenantId}] ${request.action} failed:`, error);
    return { handled: true, action: request.action, status: 'failed', response: `⚠️ ${context.botName} could not complete that action. ${message}` };
  }
}

export async function routeBotAction(message: string, context: BotActionContext): Promise<BotActionOutcome | null> {
  const request = await detectBotAction(message, context.tenantId);
  return request ? executeBotAction(request, context) : null;
}
