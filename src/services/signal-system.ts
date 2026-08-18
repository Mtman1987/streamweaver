import * as fs from 'fs/promises';
import { resolve } from 'path';
import { globalPath, listTenants } from '../lib/tenant';
import { getBotName } from '../lib/bot-settings-store';
import { readWorldLore } from '../lib/world-lore-store';
import { getSpmtEasterEggEntitlement } from '../lib/spmt-easter-eggs';
import { getDiscordStreamHubDefaultGuildId, resolveDiscordStreamHubTwitchIdentity } from './discord-stream-hub';
import { sendStructuredDiscordReply, type DiscordReplySpeaker } from './discord-structured-replies';
import { sendWebhookMessage } from './discord-webhooks';
import { deleteMessage } from './discord';
import { sendChatMessage } from './twitch';

const SIGNAL_CHANNEL_NAME = 'comms-lounge';
const SIGNAL_GAME_URL = 'https://spmt.live/signal/';
const SIGNAL_MIN_DELAY_MS = 2 * 60 * 60 * 1000;
const SIGNAL_MAX_DELAY_MS = 5 * 60 * 60 * 1000;
const SIGNAL_SCHEDULER_STATE = 'signal-scheduler.json';
const SIGNAL_COOLDOWN_STATE = 'signal-command-cooldowns.json';
const SIGNAL_TWITCH_TENANT_ID = String(process.env.SIGNAL_TWITCH_TENANT_ID || 'spacemountainlive').trim();
const CHANNEL_EXCLUDE = /(?:log|staff|admin|support|ticket|announce|moderator|mod-only|private|audit)/i;

export type SignalCommandResult = {
  handled: boolean;
  ok: boolean;
  message?: string;
  messageId?: string | null;
};

type SchedulerState = {
  guildId?: string;
  bag: string[];
  lastChannelId?: string;
  nextAt: number;
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

async function postSignalClue(channelId: string): Promise<void> {
  const speaker = await randomSignalSpeaker();
  const clue = SIGNAL_CLUES[Math.floor(Math.random() * SIGNAL_CLUES.length)];
  await sendStructuredDiscordReply({
    channelId,
    message: clue,
    title: '📡 UNIDENTIFIED SIGNAL',
    responseType: 'Signal anomaly',
    speaker,
    rotateSpeaker: false,
    embedUrl: SIGNAL_GAME_URL,
    fields: [{ name: 'Carrier', value: '[Intercept Signal](https://spmt.live/signal/)', inline: false }],
  });
}

async function schedulerTick(): Promise<void> {
  const guildId = await getDiscordStreamHubDefaultGuildId().catch(() => '');
  if (!guildId) return;
  const channels = await listGuildTextChannels(guildId).catch(() => []);
  if (!channels.length) return;
  let state = await readJson<SchedulerState>(SIGNAL_SCHEDULER_STATE, { bag: [], nextAt: Date.now() + randomDelay() });
  if (state.guildId !== guildId) state = { guildId, bag: [], nextAt: Date.now() + randomDelay() };
  if (!state.bag.length) state.bag = makeBag(channels, state.lastChannelId);
  if (!state.nextAt) state.nextAt = Date.now() + randomDelay();
  await writeJson(SIGNAL_SCHEDULER_STATE, state);
  if (Date.now() < state.nextAt || !state.bag.length) return;

  const channelId = state.bag.shift()!;
  await postSignalClue(channelId);
  state.lastChannelId = channelId;
  state.nextAt = Date.now() + randomDelay();
  if (!state.bag.length) state.bag = makeBag(channels, state.lastChannelId);
  await writeJson(SIGNAL_SCHEDULER_STATE, state);
}

let schedulerTimer: NodeJS.Timeout | null = null;
export function startSignalScheduler(): void {
  if (schedulerTimer || process.env.SIGNAL_SCHEDULER_ENABLED === 'false') return;
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

function parseSignalPayload(raw: string): { target?: string; text: string } {
  const text = String(raw || '').trim();
  const match = text.match(/^@([a-z0-9_]{3,25})(?:\s+([\s\S]*))?$/i);
  if (!match) return { text };
  return { target: match[1].toLowerCase(), text: String(match[2] || '').trim() };
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
  const guildId = String(input.msg.guildId || input.msg.guild_id || '').trim();
  const sourceMessageId = String(input.msg.messageId || input.msg.message_id || '').trim();
  if (!userId || !guildId) return { handled: true, ok: false, message: 'Signal authorization requires a linked Discord identity.' };
  const entitlement = await getSpmtEasterEggEntitlement({ provider: 'discord', providerUserId: userId });
  if (!entitlement.eggs.signal) return { handled: true, ok: false, message: 'NO CARRIER AUTHORIZATION.' };

  const parsed = parseSignalPayload(input.actualMessage.replace(/^!signal\b/i, ''));
  const linked = await resolveDiscordStreamHubTwitchIdentity(userId, guildId).catch(() => null);
  const targetName = parsed.target || String(linked?.twitchLogin || '').trim().toLowerCase();
  if (!targetName) return { handled: true, ok: false, message: 'No linked Twitch carrier was found. Use !signal @twitchname message.' };
  if (!(await signalCooldownAvailable(targetName))) return { handled: true, ok: false, message: `Carrier ${targetName} has already accepted a Signal today.` };

  const signalText = parsed.text || `A Signal from @${input.actualUsername} has crossed the network.`;
  const destinationChannelId = await resolveSignalChannelId(guildId, input.sourceChannelId);
  const posted = await postDiscordStreamHubSignal({
    guildId,
    channelId: destinationChannelId,
    requesterName: input.actualUsername,
    requesterDiscordId: userId,
    targetName,
    sourceMessageId,
    signalText,
  });
  await recordSignalCooldown(targetName);

  const local = await sendWebhookMessage(
    input.sourceChannelId,
    '',
    input.actualUsername,
    input.sourceUserAvatarUrl,
    [{
      title: '📡 SIGNAL TRANSMITTED',
      description: signalText,
      color: 0x22d3ee,
      footer: { text: `Carrier: ${targetName}` },
    }],
  ).catch((error) => {
    console.warn('[Signal] same-channel cosmetic replacement failed after carrier delivery', error);
    return null;
  });
  if (local?.id && sourceMessageId) await deleteMessage(input.sourceChannelId, sourceMessageId).catch(() => {});
  return { handled: true, ok: true, messageId: posted?.messageId || local?.id || null };
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
  const signalText = input.rawMessage.replace(/^!signal\b/i, '').trim() || `Signal from @${input.username}.`;
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
