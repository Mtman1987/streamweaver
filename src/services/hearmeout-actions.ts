const HEARMEOUT_URL = String(
  process.env.HEARMEOUT_BASE_URL || process.env.NEXT_PUBLIC_HEARMEOUT_URL || 'https://hearmeout-main.fly.dev',
).replace(/\/+$/, '');
const SPMT_BASE_URL = String(process.env.SPMT_BASE_URL || 'https://spmt.live').replace(/\/+$/, '');
const APOLLO_LOUNGE_ORIGIN = String(process.env.APOLLO_LOUNGE_ORIGIN || 'https://web-terminal-bvesa.sprites.app').replace(/\/+$/, '');
const SPACEMOUNTAIN_TENANT_ID = 'spacemountainlive';
const SPACEMOUNTAIN_LOUNGE_ROOM_ID = 'system-spacemountainlive-lounge';
const LEGACY_SPACEMOUNTAIN_LOUNGE_SESSIONS = new Set(['discord-music-room', 'discord-watch-room']);

import type { ActionBotPersona } from '@/services/bot-persona-catalog';
import { clearSpmtServiceTokenCache, getSpmtServiceToken } from '@/lib/spmt-service-token';

export type HearMeOutBotAction =
  | 'hmo.media.state.read'
  | 'hmo.media.request'
  | 'hmo.media.control'
  | 'hmo.rooms.read'
  | 'hmo.bot.control'
  | 'hmo.voice.bridge.state'
  | 'hmo.voice.bridge.control'
  | 'hmo.tts.speak';

export type HearMeOutBotActionPayload = {
  action: HearMeOutBotAction;
  tenantId: string;
  roomId?: string;
  room?: string;
  sessionId?: string;
  actorUserId?: string;
  actorName?: string;
  actorRole?: string;
  query?: string;
  lane?: 'music' | 'movie';
  channelId?: string;
  control?: string;
  value?: number;
  bot?: ActionBotPersona;
  guildId?: string;
  voiceChannel?: string;
  audioProfile?: string;
  audioDataUri?: string;
  idempotencyKey?: string;
};

function getHearMeOutServiceSecrets(): string[] {
  // HearMeOut accepts these two existing credentials, never STREAMWEAVER_SECRET.
  return [...new Set([process.env.HEARMEOUT_SERVICE_SECRET, process.env.BOT_SECRET_KEY]
    .map(value => String(value || '').trim()).filter(Boolean))];
}

const SPMT_JOB_SCOPES = ['jobs:read', 'jobs:write'];
const SPMT_LOUNGE_SERVICE_SCOPES = ['entitlements:read'];

function isSpaceMountainApolloMedia(payload: HearMeOutBotActionPayload): boolean {
  if (String(payload.tenantId || '').trim().toLowerCase() !== SPACEMOUNTAIN_TENANT_ID) return false;
  if (!payload.action.startsWith('hmo.media.')) return false;
  const roomId = String(payload.roomId || '').trim();
  const sessionId = String(payload.sessionId || '').trim();
  return roomId === SPACEMOUNTAIN_LOUNGE_ROOM_ID || LEGACY_SPACEMOUNTAIN_LOUNGE_SESSIONS.has(sessionId);
}

function spaceMountainLane(payload: HearMeOutBotActionPayload): 'music' | 'movie' {
  if (payload.lane === 'movie' || payload.lane === 'music') return payload.lane;
  return String(payload.sessionId || '') === 'discord-watch-room' ? 'movie' : 'music';
}

function normalizedActorRole(value: unknown): 'guest' | 'member' | 'moderator' | 'admin' | 'owner' {
  const role = String(value || '').trim().toLowerCase();
  return role === 'owner' || role === 'admin' || role === 'moderator' || role === 'guest' ? role : 'member';
}

async function spmtJobRequest(path: string, init: RequestInit): Promise<Response> {
  const request = async () => {
    const token = await getSpmtServiceToken(SPMT_JOB_SCOPES);
    return fetch(`${SPMT_BASE_URL}${path}`, {
      ...init,
      headers: {
        Accept: 'application/json',
        'x-spmt-app': 'streamweaver',
        'x-spmt-tenant': SPACEMOUNTAIN_TENANT_ID,
        ...((init.headers || {}) as Record<string, string>),
        Authorization: `Bearer ${token}`,
      },
      cache: 'no-store',
      signal: typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(15_000) : undefined,
    });
  };
  let response = await request();
  if (response.status === 401) {
    await response.body?.cancel().catch(() => {});
    clearSpmtServiceTokenCache(SPMT_JOB_SCOPES);
    response = await request();
  }
  return response;
}

async function executeSpaceMountainApolloMedia(payload: HearMeOutBotActionPayload): Promise<Record<string, unknown>> {
  const key = String(payload.idempotencyKey || `streamweaver-lounge:${Date.now()}`).slice(0, 200);
  const actorName = String(payload.actorName || 'Twitch viewer').trim().slice(0, 120) || 'Twitch viewer';
  const actorUserId = String(payload.actorUserId || `twitch:spacemountainlive:${actorName.toLowerCase()}`).trim().slice(0, 160);
  if (payload.action === 'hmo.media.request') {
    const query = String(payload.query || '').trim().slice(0, 500);
    if (!query) throw new Error('A song or movie request is required');
    const lane = spaceMountainLane(payload);
    const send = async () => {
      const token = await getSpmtServiceToken(SPMT_LOUNGE_SERVICE_SCOPES);
      return fetch(`${APOLLO_LOUNGE_ORIGIN}/api/watch/broadcast/service-request?roomId=${encodeURIComponent(SPACEMOUNTAIN_LOUNGE_ROOM_ID)}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'idempotency-key': key,
        },
        body: JSON.stringify({ query, lane, displayName: actorName }),
        cache: 'no-store',
        signal: typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(105_000) : undefined,
      });
    };
    let response = await send();
    if (response.status === 401) {
      await response.body?.cancel().catch(() => {});
      clearSpmtServiceTokenCache(SPMT_LOUNGE_SERVICE_SCOPES);
      response = await send();
    }
    const data = await response.json().catch(() => null) as any;
    if (!response.ok || data?.success !== true) {
      throw new Error(String(data?.error || data?.message || `Apollo Lounge request failed (${response.status})`));
    }
    return {
      ...data,
      success: true,
      action: payload.action,
      message: 'Added to the 24-Hour Lounge queue.',
      request: data.current ?? data.queue?.at?.(-1),
      route: {
        endpoint: `${APOLLO_LOUNGE_ORIGIN}/api/watch/broadcast/service-request`,
        publicRoomId: data.publicRoomId,
        programRoomId: data.programRoomId,
        sessionId: data.sessionId,
      },
    };
  }
  const args: Record<string, string> = { roomId: SPACEMOUNTAIN_LOUNGE_ROOM_ID };
  if (payload.action === 'hmo.media.control') {
    if (payload.control) args.control = String(payload.control).trim();
    if (payload.value !== undefined) args.value = String(payload.value);
  }
  const createdResponse = await spmtJobRequest('/v1/suite-actions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'idempotency-key': key },
    body: JSON.stringify({
      ownerAppId: 'streamweaver',
      input: {
        schemaVersion: 1,
        action: payload.action,
        args,
        actor: { userId: actorUserId, username: actorName, role: normalizedActorRole(payload.actorRole) },
        source: {
          kind: 'chat',
          provider: 'twitch',
          channelId: String(payload.channelId || 'spacemountainlive').trim().toLowerCase() || 'spacemountainlive',
          requestId: key,
          roomId: SPACEMOUNTAIN_LOUNGE_ROOM_ID,
        },
      },
    }),
  });
  const created = await createdResponse.json().catch(() => null) as any;
  if (!createdResponse.ok || !created?.job?.id) {
    throw new Error(String(created?.error || created?.message || `SPMT suite action failed (${createdResponse.status})`));
  }

  let job = created.job;
  const deadline = Date.now() + 105_000;
  while (!['succeeded', 'failed', 'dead-letter', 'cancelled'].includes(String(job.state)) && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 300));
    const response = await spmtJobRequest(`/v1/jobs/${encodeURIComponent(job.id)}`, { method: 'GET' });
    const next = await response.json().catch(() => null) as any;
    if (!response.ok || !next?.id) throw new Error(String(next?.error || next?.message || `SPMT job read failed (${response.status})`));
    job = next;
  }
  if (job.state !== 'succeeded') {
    const message = String(job?.error?.message || job?.error || (['failed', 'dead-letter', 'cancelled'].includes(String(job.state))
      ? `Apollo HearMeOut request ${job.state}`
      : 'Apollo HearMeOut request is still queued'));
    throw new Error(message);
  }
  const result = job.result && typeof job.result === 'object' ? job.result as Record<string, unknown> : {};
  return {
    success: true,
    action: payload.action,
    message: String((result as any).text || 'Added to the 24-Hour Lounge queue.'),
    ...result,
  };
}

export async function executeHearMeOutBotAction(payload: HearMeOutBotActionPayload): Promise<Record<string, unknown>> {
  if (isSpaceMountainApolloMedia(payload)) return executeSpaceMountainApolloMedia(payload);
  const secrets = getHearMeOutServiceSecrets();
  if (!secrets.length) throw new Error('HearMeOut shared service credential is not configured');
  const send = (secret: string) => fetch(`${HEARMEOUT_URL}/api/internal/bot/actions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(payload),
    cache: 'no-store',
    // Apollo may need both a YouTube search and a media-resolution pass before
    // it can acknowledge a Lounge request. Keep this wider than HearMeOut's
    // 75-second relay window and its final state read so StreamWeaver does not
    // cancel the accepted job while Apollo is finishing a cold start.
    signal: typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(105_000) : undefined,
  });
  let response = await send(secrets[0]);
  // Retry only a rejected, unexecuted request with the other existing key.
  if (response.status === 401 && secrets[1]) {
    await response.body?.cancel();
    response = await send(secrets[1]);
  }
  const raw = await response.text();
  let data: any = {};
  try { data = raw ? JSON.parse(raw) : {}; } catch { data = { error: raw }; }
  if (!response.ok) throw new Error(String(data?.error || `HearMeOut action failed (${response.status})`));
  if (data?.success !== true) throw new Error(`HearMeOut did not confirm ${payload.action}`);
  return data;
}

export async function speakInHearMeOutRoom(input: {
  audioDataUri: string;
  roomId?: string;
  tenantId?: string;
  actorUserId?: string;
  actorName?: string;
}): Promise<Record<string, unknown>> {
  const audioDataUri = String(input.audioDataUri || '').trim();
  if (!audioDataUri.startsWith('data:audio')) throw new Error('Room TTS requires an audio data URI');
  return executeHearMeOutBotAction({
    action: 'hmo.tts.speak',
    tenantId: String(input.tenantId || 'public-tts').trim() || 'public-tts',
    roomId: String(input.roomId || process.env.HEARMEOUT_PUBLIC_TTS_ROOM_ID || 'discord-activity').trim() || 'discord-activity',
    actorUserId: input.actorUserId,
    actorName: input.actorName,
    audioDataUri,
  });
}
