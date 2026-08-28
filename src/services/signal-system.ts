import * as fs from 'fs/promises';
import { resolve } from 'path';
import { globalPath, listTenants } from '../lib/tenant';
import { getBotName } from '../lib/bot-settings-store';
import { readWorldLore } from '../lib/world-lore-store';
import { getSpmtEasterEggEntitlement } from '../lib/spmt-easter-eggs';
import { getDiscordStreamHubDefaultGuildId, postDiscordStreamHubSignalDrop } from './discord-stream-hub';
import { sendStructuredDiscordReply, type DiscordReplySpeaker } from './discord-structured-replies';
import { buildBotAvatarUrl, resolveDiscordBotThumbnailUrl } from './discord-branding';
import { hasTenantOwnAvatar } from './discord-avatar-media';
import { sendWebhookMessage } from './discord-webhooks';
import { deleteMessage } from './discord';
import { createDiscordDmChannel, sendDiscordMessage } from './discord-local';
import { randomUUID } from 'node:crypto';
import { sendChatMessage } from './twitch';

const SIGNAL_CHANNEL_NAME = 'comms-lounge';
const SIGNAL_GAME_URL = 'https://spmt.live/signal/';
const SIGNAL_MIN_DELAY_MS = 2 * 60 * 60 * 1000;
const SIGNAL_MAX_DELAY_MS = 5 * 60 * 60 * 1000;
const SIGNAL_SCHEDULER_STATE = 'signal-scheduler.json';
const SIGNAL_HINT_HISTORY_STATE = 'signal-hint-history.json';
const SIGNAL_HINT_HISTORY_LIMIT = 500;
const SIGNAL_COOLDOWN_STATE = 'signal-command-cooldowns.json';
const SIGNAL_OWNER_DISCORD_ID = String(process.env.STREAMWEAVER_OWNER_DISCORD_ID || '767875979561009173').trim();
const SIGNAL_CLICK_STATE = 'signal-click-tracking.json';
const SIGNAL_TWITCH_TENANT_ID = String(process.env.SIGNAL_TWITCH_TENANT_ID || 'spacemountainlive').trim();
const CHANNEL_EXCLUDE = /(?:log|staff|admin|support|ticket|announce|moderator|mod-only|private|audit)/i;

export type SignalCommandResult = {
  handled: boolean;
  ok: boolean;
  message?: string;
  messageId?: string | null;
};

type SchedulerState = {
  enabled?: boolean;
  guildId?: string;
  bag: string[];
  lastChannelId?: string;
  nextAt: number;
};

type SignalHintHistoryEntry = {
  at: string;
  guildId: string;
  channelId: string;
  channelName: string;
};

type SignalHintHistoryState = {
  totalPosts: number;
  uniqueChannelIds: string[];
  lastPostAt?: string;
  history: SignalHintHistoryEntry[];
};

type CooldownState = Record<string, { day: string; at: number }>;

type DiscordChannel = { id: string; name: string; type: number };

function randomDelay(): number {
  return SIGNAL_MIN_DELAY_MS + Math.floor(Math.random() * (SIGNAL_MAX_DELAY_MS - SIGNAL_MIN_DELAY_MS + 1));
}

function shuffled<T>(values: T[]): T[] {
  const copy = [...values];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

async function readJson<T>(fileName: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(globalPath(fileName), 'utf8')) as T;
  } catch {
    return fallback;
  }
}

async function writeJson(fileName: string, value: unknown): Promise<void> {
  const file = globalPath(fileName);
  await fs.mkdir(resolve(file, '..'), { recursive: true });
  await fs.writeFile(file, JSON.stringify(value, null, 2));
}

async function recordSignalHintPost(guildId: string, channel: DiscordChannel): Promise<void> {
  const at = new Date().toISOString();
  const state = await readJson<SignalHintHistoryState>(SIGNAL_HINT_HISTORY_STATE, {
    totalPosts: 0,
    uniqueChannelIds: [],
    history: [],
  });
  const unique = new Set((state.uniqueChannelIds || []).map(String).filter(Boolean));
  unique.add(channel.id);
  const entry: SignalHintHistoryEntry = {
    at,
    guildId,
    channelId: channel.id,
    channelName: channel.name,
  };
  const history = [...(Array.isArray(state.history) ? state.history : []), entry].slice(-SIGNAL_HINT_HISTORY_LIMIT);
  const nextState: SignalHintHistoryState = {
    totalPosts: Math.max(0, Number(state.totalPosts || 0)) + 1,
    uniqueChannelIds: [...unique].sort(),
    lastPostAt: at,
    history,
  };
  await writeJson(SIGNAL_HINT_HISTORY_STATE, nextState);
  console.log('[Signal] hint posted', {
    channelId: channel.id,
    channelName: channel.name,
    totalPosts: nextState.totalPosts,
    uniqueChannels: nextState.uniqueChannelIds.length,
    historyFile: globalPath(SIGNAL_HINT_HISTORY_STATE),
  });
}

function discordBotToken(): string {
  return String(process.env.DISCORD_BOT_TOKEN || '').trim();
}

async function listGuildTextChannels(guildId: string): Promise<DiscordChannel[]> {
  const token = discordBotToken();
  if (!token || !guildId) return [];
  const response = await fetch(`https://discord.com/api/v10/guilds/${guildId}/channels`, {
    headers: { Authorization: `Bot ${token}` },
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`Discord channel lookup failed: ${response.status}`);
  const rows = await response.json().catch(() => []) as any[];
  return rows
    .filter((row) => Number(row?.type) === 0)
    .map((row) => ({ id: String(row.id || ''), name: String(row.name || ''), type: Number(row.type) }))
    .filter((row) => row.id && row.name);
}

export async function resolveSignalChannelId(guildId: string, fallbackChannelId?: string): Promise<string> {
  const channels = await listGuildTextChannels(guildId).catch(() => []);
  const comms = channels.find((channel) => channel.name.toLowerCase() === SIGNAL_CHANNEL_NAME);
  return comms?.id || String(fallbackChannelId || '').trim();
}

function eligibleChannels(channels: DiscordChannel[]): DiscordChannel[] {
  return channels.filter((channel) => !CHANNEL_EXCLUDE.test(channel.name));
}

function makeBag(channels: DiscordChannel[], lastChannelId?: string): string[] {
  const eligible = eligibleChannels(channels);
  const first = eligible.find((channel) => channel.name.toLowerCase() === SIGNAL_CHANNEL_NAME);
  const rest = shuffled(eligible.filter((channel) => channel.id !== first?.id).map((channel) => channel.id));
  if (!lastChannelId && first) return [first.id, ...rest];
  const bag = shuffled(eligible.map((channel) => channel.id));
  if (bag.length > 1 && bag[0] === lastChannelId) {
    const swap = bag.findIndex((id) => id !== lastChannelId);
    if (swap > 0) [bag[0], bag[swap]] = [bag[swap], bag[0]];
  }
  return bag;
}

async function randomSignalSpeaker(): Promise<DiscordReplySpeaker> {
  const candidates: DiscordReplySpeaker[] = [];
  const lore = await readWorldLore().catch(() => null);
  for (const character of Object.values(lore?.characters || {})) {
    const [prefix] = String(character.stableId || '').split(':');
    candidates.push({
      botName: character.currentName,
      tenantId: prefix && !['unknown', 'discordUserId', 'twitchUserId'].includes(prefix) ? prefix : undefined,
      stableId: character.stableId,
    });
  }
  for (const tenantId of await listTenants().catch(() => [])) {
    if (tenantId.startsWith('__kick_silent__')) continue;
    const botName = getBotName(tenantId);
    if (!botName) continue;
    candidates.push({ botName, tenantId, stableId: `${tenantId}:${botName.toLowerCase()}` });
  }
  const unique = Array.from(new Map(candidates.map((speaker) => [`${speaker.tenantId || 'global'}:${speaker.botName.toLowerCase()}`, speaker])).values());
  return unique[Math.floor(Math.random() * Math.max(1, unique.length))] || {
    botName: 'StreamWeaver',
    stableId: 'global:streamweaver',
  };
}

const SIGNAL_CLUES = [
  'Something is bleeding through a carrier that should not exist. I would probably intercept it before it disappears.',
  'I keep hearing the same broken transmission under the noise. That is either interesting or deeply inconvenient.',
  'Unregistered carrier detected. The source keeps slipping behind the anomaly. Someone should tune it before the path collapses.',
  'There is a signal where there should be silence. I am choosing to make that everyone else\'s problem.',
  'A transmission just crossed the dark. It is incomplete, persistent, and almost certainly a bad idea to ignore.',
];

type SignalClickRecord = {
  id: string;
  createdAt: string;
  guildId: string;
  channelId: string;
  channelName: string;
  botName: string;
  clue: string;
  clicks: number;
  lastClickedAt?: string;
};

async function sendSignalOwnerDm(message: string): Promise<void> {
  if (!SIGNAL_OWNER_DISCORD_ID) return;
  const dm = await createDiscordDmChannel(SIGNAL_OWNER_DISCORD_ID);
  await sendDiscordMessage(dm.id, message);
}

async function postSignalClue(channelId: string, guildId: string, channelName: string): Promise<void> {
  const speaker = await randomSignalSpeaker();
  const clue = SIGNAL_CLUES[Math.floor(Math.random() * SIGNAL_CLUES.length)];
  const avatarUrl = await resolveDiscordBotThumbnailUrl(speaker.tenantId).catch(() => '');
  const posted = await postDiscordStreamHubSignalDrop({
    guildId,
    channelId,
    channelName,
    clue,
    botName: speaker.botName,
    avatarUrl,
  });
  const records = await readJson<Record<string, SignalClickRecord>>(SIGNAL_CLICK_STATE, {});
  records[posted.dropId] = { id: posted.dropId, createdAt: new Date().toISOString(), guildId, channelId, channelName, botName: speaker.botName, clue, clicks: 0 };
  await writeJson(SIGNAL_CLICK_STATE, records);
  await sendSignalOwnerDm(`📡 Signal clue fired\nChannel: #${channelName} (${channelId})\nBot: ${speaker.botName}\nMessage: ${clue}\nClicks: 0`).catch((error) => {
    console.warn('[Signal] owner fire receipt failed', error);
  });
}

export async function recordSignalClueClick(id: string): Promise<SignalClickRecord | null> {
  const records = await readJson<Record<string, SignalClickRecord>>(SIGNAL_CLICK_STATE, {});
  const record = records[String(id || '').trim()];
  if (!record) return null;
  record.clicks = Math.max(0, Number(record.clicks || 0)) + 1;
  record.lastClickedAt = new Date().toISOString();
  await writeJson(SIGNAL_CLICK_STATE, records);
  await sendSignalOwnerDm(`👁️ Signal clue clicked\nChannel: #${record.channelName}\nBot: ${record.botName}\nMessage: ${record.clue}\nTotal clicks: ${record.clicks}`).catch((error) => {
    console.warn('[Signal] owner click receipt failed', error);
  });
  return record;
}

async function schedulerTick(): Promise<void> {
  const guildId = await getDiscordStreamHubDefaultGuildId().catch(() => '');
  if (!guildId) return;
  const channels = await listGuildTextChannels(guildId).catch(() => []);
  if (!channels.length) return;
  let state = await readJson<SchedulerState>(SIGNAL_SCHEDULER_STATE, { enabled: false, bag: [], nextAt: Date.now() });
  if (state.guildId !== guildId) state = { ...state, guildId, bag: [], nextAt: Date.now() };
  if (state.enabled !== true) {
    await writeJson(SIGNAL_SCHEDULER_STATE, state);
    return;
  }
  if (!state.bag.length) state.bag = makeBag(channels, state.lastChannelId);
  if (!state.nextAt) state.nextAt = Date.now() + randomDelay();
  await writeJson(SIGNAL_SCHEDULER_STATE, state);
  if (Date.now() < state.nextAt || !state.bag.length) return;

  const channelId = state.bag.shift()!;
  const channel = channels.find((candidate) => candidate.id === channelId) || { id: channelId, name: channelId, type: 0 };
  await postSignalClue(channelId, guildId, channel.name);
  await recordSignalHintPost(guildId, channel);
  state.lastChannelId = channelId;
  state.nextAt = Date.now() + randomDelay();
  if (!state.bag.length) state.bag = makeBag(channels, state.lastChannelId);
  await writeJson(SIGNAL_SCHEDULER_STATE, state);
}

export async function toggleSignalScheduler(force?: boolean): Promise<{ enabled: boolean; nextAt?: number }> {
  const current = await readJson<SchedulerState>(SIGNAL_SCHEDULER_STATE, { enabled: false, bag: [], nextAt: Date.now() });
  const enabled = typeof force === 'boolean' ? force : current.enabled !== true;
  const next: SchedulerState = { ...current, enabled, nextAt: enabled ? Date.now() : current.nextAt };
  await writeJson(SIGNAL_SCHEDULER_STATE, next);
  if (enabled) await schedulerTick();
  return { enabled, nextAt: next.nextAt };
}

let schedulerTimer: NodeJS.Timeout | null = null;
export function startSignalScheduler(): void {
  if (schedulerTimer) return;
  schedulerTimer = setInterval(() => void schedulerTick().catch((error) => console.warn('[Signal] scheduler tick failed', error)), 60_000);
  schedulerTimer.unref?.();
  void schedulerTick().catch((error) => console.warn('[Signal] scheduler bootstrap failed', error));
}

function dayKey(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

async function signalCooldownAvailable(target: string): Promise<boolean> {
  const key = target.toLowerCase();
  const state = await readJson<CooldownState>(SIGNAL_COOLDOWN_STATE, {});
  return state[key]?.day !== dayKey();
}

async function recordSignalCooldown(target: string): Promise<void> {
  const key = target.toLowerCase();
  const state = await readJson<CooldownState>(SIGNAL_COOLDOWN_STATE, {});
  state[key] = { day: dayKey(), at: Date.now() };
  await writeJson(SIGNAL_COOLDOWN_STATE, state);
}

async function postDiscordStreamHubSignal(input: {
  guildId: string;
  channelId: string;
  requesterName: string;
  requesterDiscordId?: string;
  targetName: string;
  sourceMessageId?: string;
  signalText: string;
}): Promise<{ messageId?: string | null; isLive?: boolean }> {
  const base = String(process.env.DISCORD_STREAM_HUB_URL || process.env.NEXT_PUBLIC_DISCORD_STREAM_HUB_URL || 'https://discord-stream-hub-new.fly.dev').replace(/\/$/, '');
  const secret = String(process.env.DSH_SERVICE_SECRET || process.env.DSH_CLIENT_SECRET || process.env.BOT_SECRET_KEY || '').trim();
  if (!secret) throw new Error('DSH service secret is not configured');
  const response = await fetch(`${base}/api/discord/manual-shoutout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
    body: JSON.stringify({
      serverId: input.guildId,
      channelId: input.channelId,
      requesterName: input.requesterName,
      requesterDiscordId: input.requesterDiscordId,
      targetName: input.targetName,
      sourceMessageId: input.sourceMessageId,
      kind: 'signal',
      signalText: input.signalText,
    }),
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`Signal shoutout failed: ${response.status} ${await response.text().catch(() => '')}`);
  return response.json().catch(() => ({}));
}

function boldSignalText(value: string): string {
  const escaped = String(value || '').replace(/\\/g, '\\\\').replace(/\*/g, '\\*').trim();
  return `**${escaped}**`;
}

async function resolveSignalDiscordAvatarUrl(): Promise<string> {
  const configured = String(process.env.SIGNAL_DISCORD_GIF_URL || '').trim();
  if (/^https?:\/\//i.test(configured)) return configured;
  if (hasTenantOwnAvatar(SIGNAL_TWITCH_TENANT_ID)) return buildBotAvatarUrl(SIGNAL_TWITCH_TENANT_ID);
  return resolveDiscordBotThumbnailUrl(SIGNAL_TWITCH_TENANT_ID).catch(() => '');
}

export async function handleDiscordSignalCommand(input: {
  msg: any;
  tenantId?: string;
  actualUsername: string;
  actualMessage: string;
  sourceChannelId: string;
  sourceUserAvatarUrl?: string;
}): Promise<SignalCommandResult> {
  const userId = String(input.msg.author?.id || input.msg.userId || input.msg.user_id || '').trim();
  const sourceMessageId = String(input.msg.messageId || input.msg.message_id || '').trim();
  if (!userId) return { handled: true, ok: false, message: 'Signal authorization requires a linked Discord identity.' };

  const signalText = input.actualMessage.replace(/^!signal\b/i, '').trim();
  if (!signalText) return { handled: true, ok: false, message: 'usage: !signal <message>' };

  const entitlement = await getSpmtEasterEggEntitlement({ provider: 'discord', providerUserId: userId });
  if (!entitlement.eggs.signal) return { handled: true, ok: false, message: 'NO CARRIER AUTHORIZATION.' };

  const signalAvatarUrl = await resolveSignalDiscordAvatarUrl();
  const local = await sendWebhookMessage(
    input.sourceChannelId,
    '',
    input.actualUsername,
    signalAvatarUrl || input.sourceUserAvatarUrl,
    [{
      title: '📡 SIGNAL',
      description: boldSignalText(signalText),
      color: 0x22d3ee,
      ...(signalAvatarUrl ? { thumbnail: { url: signalAvatarUrl } } : {}),
    }],
  );

  if (!local?.id) {
    throw new Error('Signal replacement could not be posted in this Discord channel.');
  }
  if (sourceMessageId) {
    await deleteMessage(input.sourceChannelId, sourceMessageId).catch((error) => {
      console.warn('[Signal] replacement posted but source Discord command could not be deleted', error);
    });
  }
  return { handled: true, ok: true, messageId: local.id };
}

export async function handleTwitchSignalCommand(input: {
  providerUserId: string;
  username: string;
  broadcaster: string;
  tenantId?: string;
  rawMessage: string;
}): Promise<SignalCommandResult> {
  const entitlement = await getSpmtEasterEggEntitlement({ provider: 'twitch', providerUserId: input.providerUserId });
  if (!entitlement.eggs.signal) return { handled: true, ok: false, message: `@${input.username}, NO CARRIER AUTHORIZATION.` };

  const signalText = input.rawMessage.replace(/^!signal\b/i, '').trim();
  if (!signalText) return { handled: true, ok: false, message: `@${input.username}, usage: !signal <message>` };

  const targetName = input.broadcaster.replace(/^#/, '').trim().toLowerCase();
  if (!(await signalCooldownAvailable(targetName))) return { handled: true, ok: false, message: `@${input.username}, this carrier has already accepted a Signal today.` };

  const guildId = await getDiscordStreamHubDefaultGuildId();
  const channelId = await resolveSignalChannelId(guildId);
  if (!channelId) throw new Error(`${SIGNAL_CHANNEL_NAME} was not found in the Space Mountain Discord.`);

  const posted = await postDiscordStreamHubSignal({
    guildId,
    channelId,
    requesterName: input.username,
    targetName,
    signalText,
  });
  await recordSignalCooldown(targetName);

  await sendChatMessage(`📡 SIGNAL ACKNOWLEDGED — transmission accepted from @${input.username}.`, 'bot', targetName, SIGNAL_TWITCH_TENANT_ID).catch((error) => {
    console.warn('[Signal] Discord carrier posted but SpaceMountainLive Twitch acknowledgement failed', error);
  });
  return { handled: true, ok: true, messageId: posted?.messageId || null };
}
