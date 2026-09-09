const HEARMEOUT_URL = String(
  process.env.HEARMEOUT_BASE_URL || process.env.NEXT_PUBLIC_HEARMEOUT_URL || 'https://hearmeout-main.fly.dev',
).replace(/\/+$/, '');

import type { ActionBotPersona } from '@/services/bot-persona-catalog';

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

export async function executeHearMeOutBotAction(payload: HearMeOutBotActionPayload): Promise<Record<string, unknown>> {
  const secrets = getHearMeOutServiceSecrets();
  if (!secrets.length) throw new Error('HearMeOut shared service credential is not configured');
  const send = (secret: string) => fetch(`${HEARMEOUT_URL}/api/internal/bot/actions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(payload),
    cache: 'no-store',
    signal: typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(55_000) : undefined,
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