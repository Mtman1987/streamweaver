import { sendChatMessage } from './twitch';
import { randomUUID } from 'node:crypto';
import { awardNebulaCheckinBonus } from './nebula-actions';
import { recordDetailedCheckin } from './checkin-stats';
import { getCheckinSource, type CheckinEntry, type CheckinKind, type CheckinSourceResult } from './checkin-sources';
import { getStoredTokens } from '../lib/token-utils.server';
import { readJsonFile, writeJsonFile } from './storage';
import { internalServiceHeaders } from '../lib/internal-service-auth';
import { SPACEMOUNTAIN_SYSTEM_TENANT_ID } from '../lib/tenant';
import { createCheckinOverlayEvent, rememberCheckinOverlayEvent } from './checkin-overlay-state';

const FRONT_SEAT_FILE = 'space-mountain-front-seat.json';
export const FRONT_SEAT_BONUS_POINTS = 100;

type FrontSeatHistory = { history: string[] }; // last N usernames who got front seat

/**
 * Pick a front seat rider, rotating so no one gets it every time.
 * Picks from riders who haven't had it recently; falls back to random if all have.
 */
async function pickFrontSeat(riders: CheckinEntry[], tenantId?: string): Promise<CheckinEntry> {
  if (riders.length <= 1) return riders[0];

  const ctx = tenantId ? { tenantId, username: '' } : undefined;
  const data = await readJsonFile<FrontSeatHistory>(FRONT_SEAT_FILE, { history: [] }, ctx);
  const recentSet = new Set(data.history.slice(-Math.max(5, Math.floor(riders.length * 0.6))));

  // Prefer riders who haven't had front seat recently
  const eligible = riders.filter(r => !recentSet.has(r.name.toLowerCase()));
  const pool = eligible.length > 0 ? eligible : riders;

  const winner = pool[Math.floor(Math.random() * pool.length)];

  // Record this winner
  data.history.push(winner.name.toLowerCase());
  // Keep last 20 entries
  if (data.history.length > 20) data.history = data.history.slice(-20);
  await writeJsonFile(FRONT_SEAT_FILE, data, ctx);

  return winner;
}

type PointsContext = { tenantId: string; username: string } | undefined;

function normalizeTenantId(tenantId?: string): string | undefined {
  if (tenantId?.startsWith('__kick_silent__:')) return tenantId.slice('__kick_silent__:'.length);
  return tenantId;
}

async function resolvePointsCtx(tenantId?: string): Promise<PointsContext> {
  tenantId = normalizeTenantId(tenantId);
  if (!tenantId) return undefined;
  try {
    const tokens = await getStoredTokens(tenantId);
    return { tenantId, username: tokens?.broadcasterUsername || '' };
  } catch {
    return { tenantId, username: '' };
  }
}

function labels(kind: CheckinKind) {
  switch (kind) {
    case 'partner':
      return { title: 'Partner Check-In', entity: 'partner', group: 'community', color: '#FFD700', emoji: '🤝' };
    case 'crew':
      return { title: 'Crew Check-In', entity: 'crew member', group: 'crew', color: '#00D2FF', emoji: '🛠️' };
    case 'mod':
      return { title: 'Mod Check-In', entity: 'mod', group: 'mod squad', color: '#9B5CFF', emoji: '🛡️' };
    case 'space-mountain':
      return { title: 'Space Mountain', entity: 'rider', group: 'ride crew', color: '#FF4D6D', emoji: '🚀' };
  }
}

function broadcastCheckin(type: 'pending' | 'reveal', payload: Record<string, unknown>, tenantId?: string) {
  const broadcastTenantId = normalizeTenantId(tenantId);
  const event = createCheckinOverlayEvent(type === 'pending' ? 'checkin-pending' : 'checkin-reveal', payload);
  if (broadcastTenantId) rememberCheckinOverlayEvent(broadcastTenantId, event);
  if (typeof (global as any).broadcast !== 'function') {
    console.info('[CheckinOverlay] HTTPS replay saved the event; this worker has no local WebSocket broadcaster');
    return;
  }
  const broadcast = (global as any).broadcast;

  const delivered = broadcast(event, broadcastTenantId);
  console.log(`[CheckinOverlay] ${type} tenant=${broadcastTenantId || 'global'} clients=${typeof delivered === 'number' ? delivered : 'unknown'}`);

  // Keep the legacy partner overlay event stream alive so older /partner-checkin
  // browser tabs still render crew/mod/space mountain check-ins without needing a
  // hard refresh.
  if (type === 'pending') {
    broadcast({
      type: 'partner-checkin-pending',
      payload: {
        username: payload.username,
        kind: payload.kind,
        sourceLabel: payload.sourceLabel,
        title: payload.title,
        subtitle: payload.subtitle,
        accentColor: payload.accentColor,
        emoji: payload.emoji,
        count: payload.count,
      },
    }, broadcastTenantId);
    return;
  }

  const entry = (payload.entry && typeof payload.entry === 'object') ? payload.entry as Record<string, unknown> : null;
  broadcast({
    type: 'partner-checkin',
    payload: {
      username: payload.username,
      kind: payload.kind,
      sourceLabel: payload.sourceLabel,
      accentColor: payload.accentColor,
      emoji: payload.emoji,
      bulk: payload.bulk,
      count: payload.count,
      names: payload.names,
      partner: entry ? {
        id: entry.id,
        name: entry.name,
        imageUrl: entry.imageUrl,
      } : null,
      entry,
    },
  }, broadcastTenantId);
}

const recentCheckinLines = new Map<string, string[]>();

async function freshCheckinLine(tenantId: string | undefined, kind: CheckinKind, prompt: string, fallbacks: string[], requiredNames: string[]): Promise<string> {
  const key = `${tenantId || 'global'}:${kind}`;
  const recent = recentCheckinLines.get(key) || [];
  const namesInstruction = new Set(requiredNames.map(name => name.toLowerCase())).size === 1
    ? 'Use the viewer name once; this is one person.'
    : 'Use both names exactly.';
  let line = '';
  try {
    const { generateAIResponse } = await import('./ai-provider');
    const { getBotName, getBotPersonality } = require('../lib/bot-settings-store');
    line = await generateAIResponse(
      `${prompt} Write one fresh, playful Space Mountain themed line in Stella's voice. ${namesInstruction} No statistics, numbers, URLs, parentheses, markdown, or generic "welcome" greeting. Vary the opening and imagery. Do not repeat: ${JSON.stringify(recent.slice(-8))}`,
      `You are ${getBotName(tenantId) || 'Stella'}. ${getBotPersonality(tenantId) || ''}`,
      tenantId,
      { maxTokens: 110, maxCharacters: 260, temperature: 1 },
    );
    line = String(line || '').replace(/\s*\([^)]*\)/g, '').replace(/https?:\/\/\S+/gi, '').replace(/\s+/g, ' ').replace(/^["'\s]+|["'\s]+$/g, '').trim().slice(0, 240);
    if (!requiredNames.every(name => line.toLowerCase().includes(name.toLowerCase())) || recent.includes(line)) line = '';
  } catch (error) {
    console.warn('[Checkin] Stella line generation fell back:', error);
  }
  if (!line) {
    const choices = fallbacks.filter(candidate => !recent.includes(candidate));
    const pool = choices.length ? choices : fallbacks;
    line = pool[Math.floor(Math.random() * pool.length)];
  }
  recentCheckinLines.set(key, [...recent, line].slice(-12));
  return line;
}

async function generateGreeting(username: string, entry: CheckinEntry, kind: CheckinKind, sourceLabel: string, tenantId?: string): Promise<string> {
  const actor = `@${username}`;
  const name = entry.name;
  const fallbacks: Record<CheckinKind, string[]> = {
    partner: [
      `${actor}, you found ${name} on the partner deck. Give this mountain connection a proper salute!`,
      `The partner beacon just lit up for ${actor} and ${name}. That's a crew-up worth celebrating!`,
      `${actor} and ${name} are sharing a seat on the partner shuttle. Let the good adventures begin!`,
    ],
    crew: [
      `${actor}, your crew seat is beside ${name}! Keep that mountain energy rolling.`,
      `Crew doors open for ${actor} and ${name}. This ride just got a little brighter!`,
      `${name} has a new crewmate in ${actor}. Everybody make some room on the launch deck!`,
    ],
    mod: [
      `${actor} just linked up with mod ${name}. The command deck is in good hands!`,
      `Mod squad check-in complete for ${actor} and ${name}. Shields up, smiles on!`,
      `${name} welcomes ${actor} aboard the mod deck. Keep the mountain humming!`,
    ],
    'space-mountain': [
      `${actor} grabbed a Space Mountain seat with ${name}. Buckle up, crew!`,
      `Launch lights are on for ${actor} and ${name}. Here comes the mountain!`,
      `${name} saved ${actor} a seat on the ride. Everybody hold on!`,
    ],
  };
  const checkingInWithSelf = username.toLowerCase() === name.toLowerCase();
  const prompt = checkingInWithSelf
    ? `${actor} landed on their own name for a ${sourceLabel} check-in. Celebrate the funny solo match without repeating their name or implying there are two people.`
    : `${actor} selected ${name} for a ${sourceLabel} check-in. Celebrate that specific pairing in one or two short sentences.`;
  const soloFallbacks = [
    `${actor}, the ${sourceLabel} roster just pointed straight back at you. That's a star turn!`,
    `Plot twist, ${actor}: you're the ${sourceLabel} pick this time. Take your bow on the launch deck!`,
    `The ${sourceLabel} beacon found ${actor} right where it started. Own that spotlight!`,
  ];
  return freshCheckinLine(tenantId, kind, prompt,
    checkingInWithSelf ? soloFallbacks : fallbacks[kind], [username, name]);
}

async function generateBulkGreeting(username: string, frontSeat: string, kind: CheckinKind, tenantId?: string): Promise<string> {
  const actor = `@${username}`;
  const fallbacks = [
    `${actor} sent the mountain crew into orbit, and ${frontSeat} claimed the front seat. Hold on tight!`,
    `The ride is rolling, ${actor}! ${frontSeat} has the front seat and the whole crew is along for the climb.`,
    `Launch doors sealed for ${actor}'s crew. ${frontSeat} is up front—let's make this a ride to remember!`,
  ];
  return freshCheckinLine(tenantId, kind,
    `${actor} launched a Space Mountain group check-in and ${frontSeat} got the front seat. Celebrate the ride and front-seat rider in one or two short sentences.`,
    fallbacks, [username, frontSeat]);
}

async function playGreeting(greeting: string, tenantId?: string): Promise<void> {
  const { markTtsHandled } = require('./chat-dispatcher');
  markTtsHandled(greeting);
  await sendChatMessage(greeting, 'bot', undefined, tenantId);
  // Space Mountain's confirmed Stella chat receipt queues its own TTS.
  if (normalizeTenantId(tenantId) === SPACEMOUNTAIN_SYSTEM_TENANT_ID) return;

  try {
    const { textToSpeech } = await import('../ai/flows/text-to-speech');
    const ttsTenantId = normalizeTenantId(tenantId);
    const spokenGreeting = greeting.replace(/\s*\([^)]*\)/g, '').trim();
    const ttsResult = await textToSpeech({ text: spokenGreeting, tenantId: ttsTenantId });
    if (!ttsResult.audioDataUri) return;

    const useTTSPlayer = process.env.USE_TTS_PLAYER !== 'false';
    if (useTTSPlayer) {
      const tenantQuery = ttsTenantId ? `?tenant=${encodeURIComponent(ttsTenantId)}` : '';
      await fetch(`http://127.0.0.1:${process.env.PORT || 3100}/api/tts/current${tenantQuery}`, {
        method: 'POST',
        headers: internalServiceHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ audioUrl: ttsResult.audioDataUri, text: spokenGreeting }),
      }).catch(() => {});
    } else if (typeof (global as any).broadcast === 'function') {
      (global as any).broadcast({ type: 'play-tts', payload: { audioDataUri: ttsResult.audioDataUri } }, ttsTenantId);
    }
  } catch (error) {
    console.error('[Checkin] TTS error:', error);
  }
}

async function chargePoints(username: string, pointCost: number, reason: string, tenantId?: string): Promise<number | null> {
  if (pointCost <= 0) return null;
  const pointsCtx = await resolvePointsCtx(tenantId);
  const { getUserPoints, addPoints } = require('./points');
  const points = await getUserPoints(username, pointsCtx);
  if (points < pointCost) return points;
  await addPoints(username, -pointCost, reason, pointsCtx);
  return null;
}

async function getBalance(username: string, tenantId?: string): Promise<number | null> {
  try {
    const { getUserPoints } = require('./points');
    return await getUserPoints(username, await resolvePointsCtx(tenantId));
  } catch {
    return null;
  }
}

export function formatCheckinList(kind: CheckinKind, entries: CheckinEntry[]): string {
  const copy = labels(kind);
  const list = entries.map((entry) => `${entry.id}.${entry.name}`).join(' ');
  return `${copy.title}s: ${list}`;
}

export function createPendingPayload(kind: CheckinKind, username: string, sourceLabel: string, extra?: Record<string, unknown>) {
  const copy = labels(kind);
  return {
    kind,
    username,
    title: copy.title,
    subtitle: `${username} is locking in a ${copy.title.toLowerCase()}...`,
    sourceLabel,
    accentColor: copy.color,
    emoji: copy.emoji,
    ...extra,
  };
}

export async function resolveCheckinSelection(kind: CheckinKind, selectionNumber: number, tenantId?: string, actorUsername?: string): Promise<{ sourceLabel: string; entry: CheckinEntry | null }> {
  const source = await getCheckinSource(kind, tenantId, actorUsername);
  return {
    sourceLabel: source.sourceLabel,
    entry: source.entries.find((item) => item.id === selectionNumber) || null,
  };
}

export async function runCheckin(kind: CheckinKind, username: string, selectionNumber: number, pointCost: number, tenantId?: string): Promise<void> {
  const copy = labels(kind);
  const insufficient = await chargePoints(username, pointCost, `${kind}-checkin`, tenantId);
  if (insufficient !== null) {
    await sendChatMessage(`@${username}, you need ${pointCost} points for a ${copy.title.toLowerCase()}! (You have ${insufficient})`, 'broadcaster', undefined, tenantId).catch(() => {});
    return;
  }

  const { entry, sourceLabel } = await resolveCheckinSelection(kind, selectionNumber, tenantId, username);
  if (!entry) {
    await sendChatMessage(`@${username}, that ${copy.entity} number does not exist.`, 'broadcaster', undefined, tenantId).catch(() => {});
    return;
  }

  broadcastCheckin('pending', createPendingPayload(kind, username, sourceLabel), tenantId);
  const stats = recordDetailedCheckin(username, entry.key, entry.name, kind, tenantId);
  broadcastCheckin('reveal', {
    kind,
    username,
    sourceLabel,
    accentColor: copy.color,
    emoji: copy.emoji,
    selectionNumber,
    entry: {
      ...entry,
      imageUrl: entry.imageUrl,
    },
  }, tenantId);
  const greeting = await generateGreeting(username, entry, kind, sourceLabel, tenantId);
  const statsParts = [`${username}: ${stats.userTotal} total`, `${entry.name}: ${stats.entryTotal} total`];
  if (pointCost > 0) {
    const balance = await getBalance(username, tenantId);
    if (typeof balance === 'number') statsParts.push(`Balance: ${balance} pts`);
  }
  await playGreeting(`${greeting} (${statsParts.join(' | ')})`, tenantId);

  // Post to tenant's shoutout Discord channel if bridge is enabled
  try {
    if (tenantId) {
      const { readDiscordConfig } = require('../lib/discord-config');
      const dcConfig = await readDiscordConfig(tenantId);
      if (dcConfig.discordBridgeEnabled !== false && dcConfig.shoutoutChannelId) {
        const { sendDiscordMessage: sendDM } = require('./discord');
        await sendDM(dcConfig.shoutoutChannelId, `${copy.emoji} **${username}** just checked in with **${entry.name}** during a **${copy.title}**!`);
      }
    }
  } catch {}

}

export interface BulkCheckinResult {
  reply: string;
  payload?: Record<string, unknown>;
}
export interface BulkCheckinOptions {
  source?: CheckinSourceResult;
  deliver?: (message: string) => Promise<void>;
  awardId?: string;
  channel?: string;
}

export async function runBulkCheckin(kind: CheckinKind, username: string, pointCost: number, tenantId?: string, options: BulkCheckinOptions = {}): Promise<BulkCheckinResult> {
  const source = options.source || await getCheckinSource(kind, tenantId, username);
  const copy = labels(kind);
  if (source.entries.length === 0) {
    const message = source.error
      ? `@${username}, ${copy.title} rider lookup is unavailable right now: ${source.error}`
      : `@${username}, no eligible Space Mountain members are active in chat right now.`;
    if (options.deliver) await options.deliver(message);
    else await sendChatMessage(message, 'broadcaster', undefined, tenantId).catch(() => {});
    return { reply: message };
  }

  const insufficient = await chargePoints(username, pointCost, `${kind}-checkin`, tenantId);
  if (insufficient !== null) {
    const reply = `@${username}, you need ${pointCost} points for ${copy.title}! (You have ${insufficient})`;
    if (options.deliver) await options.deliver(reply);
    else await sendChatMessage(reply, 'broadcaster', undefined, tenantId).catch(() => {});
    return { reply };
  }

  broadcastCheckin('pending', createPendingPayload(kind, username, source.sourceLabel, { count: source.entries.length }), tenantId);
  const checkedIn = source.entries.map((entry) => {
    const stats = recordDetailedCheckin(username, entry.key, entry.name, kind, tenantId);
    return { ...entry, total: stats.entryTotal };
  });

  // Pick front seat rider — rotate so no one gets it every time
  const frontSeatRider = await pickFrontSeat(checkedIn, tenantId);
  let bonusPoints = 0;
  let bonusBalance: number | undefined;
  if (kind === 'space-mountain') {
    try {
      const channel = options.channel || (await resolvePointsCtx(tenantId))?.username || normalizeTenantId(tenantId) || SPACEMOUNTAIN_SYSTEM_TENANT_ID;
      const award = await awardNebulaCheckinBonus({
        awardId: options.awardId || randomUUID(), channel: channel.toLowerCase().replace(/^#/, ''),
        username: (frontSeatRider.twitchLogin || frontSeatRider.name).toLowerCase(),
        userId: frontSeatRider.twitchUserId, displayName: frontSeatRider.name,
      });
      bonusPoints = award.amount;
      bonusBalance = award.balance;
    } catch (error) {
      console.error('[Checkin] Nebula front-seat credit could not be confirmed:', error);
    }
  }

  // Show the result immediately; speech generation can take longer than the
  // reveal window and must not make the card disappear before it ever displays.
  const payload: Record<string, unknown> = {
    kind,
    username,
    sourceLabel: source.sourceLabel,
    accentColor: copy.color,
    emoji: copy.emoji,
    bulk: true,
    count: checkedIn.length,
    names: checkedIn.map((entry) => entry.name),
    frontSeat: frontSeatRider.name,
    frontSeatBonusPoints: bonusPoints,
    frontSeatBonusCurrency: 'Nebula points',
    frontSeatBonusStatus: kind !== 'space-mountain' ? 'not-applicable' : bonusPoints ? 'credited' : 'unconfirmed',
    frontSeatNebulaBalance: bonusBalance,
    entry: frontSeatRider,
  };
  broadcastCheckin('reveal', payload, tenantId);

  const greeting = await generateBulkGreeting(username, frontSeatRider.name, kind, tenantId);
  const statsParts = [`Riders: ${checkedIn.length}`, `Front seat: ${frontSeatRider.name}`];
  if (kind === 'space-mountain') statsParts.push(bonusPoints
    ? `Bonus: ${bonusPoints} Nebula points | Nebula balance: ${bonusBalance}`
    : 'Nebula bonus could not be confirmed');
  if (pointCost > 0) {
    const balance = await getBalance(username, tenantId);
    if (typeof balance === 'number') statsParts.push(`Balance: ${balance} pts`);
  }
  const reply = `${greeting} (${statsParts.join(' | ')})`;
  if (options.deliver) await options.deliver(reply);
  else await playGreeting(reply, tenantId);
  return { reply, payload };
}
