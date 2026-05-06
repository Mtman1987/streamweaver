import { sendChatMessage } from './twitch';
import { recordDetailedCheckin, getEntryInviteLink } from './checkin-stats';
import { getCheckinSource, type CheckinEntry, type CheckinKind } from './checkin-sources';
import { getStoredTokens } from '../lib/token-utils.server';

type PointsContext = { tenantId: string; username: string } | undefined;

async function resolvePointsCtx(tenantId?: string): Promise<PointsContext> {
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
  if (typeof (global as any).broadcast !== 'function') return;
  const broadcast = (global as any).broadcast;

  broadcast({
    type: type === 'pending' ? 'checkin-pending' : 'checkin-reveal',
    payload,
  }, tenantId);

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
    }, tenantId);
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
  }, tenantId);
}

async function generateGreeting(username: string, entry: CheckinEntry, kind: CheckinKind, sourceLabel: string, tenantId?: string): Promise<string> {
  const { getBotName, getBotPersonality } = require('../lib/bot-settings-store');
  const botName = getBotName(tenantId);
  const botPersonality = getBotPersonality(tenantId);
  const copy = labels(kind);
  let greeting = `Welcome ${entry.name}! ${username} just checked in with the ${copy.group}.`;

  const edenaiKey = process.env.EDENAI_API_KEY;
  if (!edenaiKey) return greeting;

  try {
    const response = await fetch('https://api.edenai.run/v2/text/chat', {
      method: 'POST',
      headers: { Authorization: `Bearer ${edenaiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        providers: 'openai',
        text: `You are ${botName}. A viewer named ${username} just used a ${copy.title} and landed on ${entry.name}. ${entry.name} belongs to the ${sourceLabel} list. Write a short, energetic 1-2 sentence greeting that welcomes ${username} while hyping up ${entry.name} and the ${sourceLabel}. Stay fully in character.`,
        chatbot_global_action: botPersonality,
        temperature: 0.8,
        max_tokens: 150,
      }),
    });
    if (!response.ok) return greeting;

    const data = await response.json() as any;
    const text = data?.openai?.generated_text?.trim();
    return text || greeting;
  } catch {
    return greeting;
  }
}

async function playGreeting(greeting: string, tenantId?: string): Promise<void> {
  const { markTtsHandled } = require('./chat-dispatcher');
  markTtsHandled(greeting);
  await sendChatMessage(greeting, 'bot', undefined, tenantId);

  try {
    const { textToSpeech } = await import('../ai/flows/text-to-speech');
    const ttsResult = await textToSpeech({ text: greeting });
    if (!ttsResult.audioDataUri) return;

    const useTTSPlayer = process.env.USE_TTS_PLAYER !== 'false';
    if (useTTSPlayer) {
      const tenantQuery = tenantId ? `?tenant=${encodeURIComponent(tenantId)}` : '';
      await fetch(`http://127.0.0.1:${process.env.PORT || 3100}/api/tts/current${tenantQuery}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audioUrl: ttsResult.audioDataUri }),
      }).catch(() => {});
    } else if (typeof (global as any).broadcast === 'function') {
      (global as any).broadcast({ type: 'play-tts', payload: { audioDataUri: ttsResult.audioDataUri } }, tenantId);
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
  broadcastCheckin('pending', createPendingPayload(kind, username, copy.group), tenantId);

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

  const stats = recordDetailedCheckin(username, entry.key, entry.name, kind, tenantId);
  const inviteLink = entry.inviteLink || getEntryInviteLink(entry.key, tenantId);

  let broadcasterMsg = `@${username} just checked in with ${entry.name}'s ${copy.title.toLowerCase()}!`;
  if (inviteLink) broadcasterMsg += ` Join here: ${inviteLink}`;
  broadcasterMsg += ` (${username}: ${stats.userTotal} total | ${entry.name}: ${stats.entryTotal} total)`;
  if (pointCost > 0) {
    const balance = await getBalance(username, tenantId);
    if (typeof balance === 'number') broadcasterMsg += ` | Balance: ${balance} pts`;
  }
  await sendChatMessage(broadcasterMsg, 'broadcaster', undefined, tenantId);

  const greeting = await generateGreeting(username, entry, kind, sourceLabel, tenantId);
  await playGreeting(greeting, tenantId);

  if (process.env.DISCORD_WEBHOOK_URL) {
    await fetch(process.env.DISCORD_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: `${copy.emoji} **${username}** just checked in with **${entry.name}** during a **${copy.title}**!` }),
    }).catch(() => {});
  }

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
}

export async function runBulkCheckin(kind: CheckinKind, username: string, pointCost: number, tenantId?: string): Promise<void> {
  const source = await getCheckinSource(kind, tenantId, username);
  const copy = labels(kind);
  broadcastCheckin('pending', createPendingPayload(kind, username, source.sourceLabel, { count: source.entries.length }), tenantId);

  const insufficient = await chargePoints(username, pointCost, `${kind}-checkin`, tenantId);
  if (insufficient !== null) {
    await sendChatMessage(`@${username}, you need ${pointCost} points for ${copy.title}! (You have ${insufficient})`, 'broadcaster', undefined, tenantId).catch(() => {});
    return;
  }

  if (source.entries.length === 0) {
    await sendChatMessage(`@${username}, no one is queued up for ${copy.title} right now.`, 'broadcaster', undefined, tenantId).catch(() => {});
    return;
  }

  const checkedIn = source.entries.map((entry) => {
    const stats = recordDetailedCheckin(username, entry.key, entry.name, kind, tenantId);
    return { ...entry, total: stats.entryTotal };
  });

  const names = checkedIn.slice(0, 8).map((entry) => entry.name).join(', ');
  const suffix = checkedIn.length > 8 ? ` and ${checkedIn.length - 8} more` : '';
  let broadcasterMsg = `@${username} launched ${copy.title} and checked in ${checkedIn.length} riders: ${names}${suffix}`;
  if (pointCost > 0) {
    const balance = await getBalance(username, tenantId);
    if (typeof balance === 'number') broadcasterMsg += ` | Balance: ${balance} pts`;
  }
  await sendChatMessage(broadcasterMsg, 'broadcaster', undefined, tenantId);

  const lead = checkedIn[0];
  const greeting = `${copy.emoji} ${username} just blasted ${checkedIn.length} people through ${copy.title}. Front seat goes to ${lead.name}!`;
  await playGreeting(greeting, tenantId);

  broadcastCheckin('reveal', {
    kind,
    username,
    sourceLabel: source.sourceLabel,
    accentColor: copy.color,
    emoji: copy.emoji,
    bulk: true,
    count: checkedIn.length,
    names: checkedIn.map((entry) => entry.name),
    entry: lead,
  }, tenantId);
}
