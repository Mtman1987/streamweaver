import { NextRequest } from 'next/server';
import { apiError, apiOk } from '@/lib/api-response';
import { internalServiceHeaders } from '@/lib/internal-service-auth';
import { getBotName } from '@/lib/bot-settings-store';
import { detectOpenBotCommandWithAi, runOpenBotCommand } from '@/services/open-bot-commands';
import { routeBotAction } from '@/services/bot-action-runtime';
import { generateTTS } from '@/services/tts-provider';
import { DEFAULT_TTS_VOICE } from '@/lib/tts-voices';
import { isTheCountName, isTheCountTwitchLogin } from '@/lib/the-count';

function text(value: unknown, max = 5000) {
  return String(value || '').trim().slice(0, max);
}

function internalBaseUrl() {
  const port = String(process.env.PORT || '3000').trim() || '3000';
  return `http://127.0.0.1:${port}`;
}

function hearMeOutSayStreamKey(roomId: unknown, personaTenantId: unknown): string {
  const clean = (value: unknown, fallback: string) => (
    text(value, 96)
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || fallback
  );
  return `hmo-say-${clean(roomId, 'room')}-${clean(personaTenantId, 'persona')}`.slice(0, 128);
}

async function conversationalReply(input: { tenantId: string; roomId: string; command: string }) {
  const response = await fetch(`${internalBaseUrl()}/api/ai/chat-with-memory`, {
    method: 'POST',
    headers: internalServiceHeaders({ 'Content-Type': 'application/json', Accept: 'application/json' }),
    body: JSON.stringify({
      username: `hearmeout-room-${input.roomId || 'voice'}`,
      userId: `hearmeout-room-${input.roomId || 'voice'}`,
      displayName: 'HearMeOut room',
      message: input.command,
      tenantId: input.tenantId,
      context: 'voice',
    }),
    cache: 'no-store',
    signal: typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(60_000) : undefined,
  });
  const payload = await response.json().catch(() => ({})) as any;
  if (!response.ok) throw new Error(text(payload?.error?.message || payload?.error || `AI returned ${response.status}`, 1000));
  return text(payload?.data?.response || payload?.response, 5000);
}

export async function POST(request: NextRequest) {
  // PUBLIC CHATBOT INVARIANT: a human talking to a room persona never requires
  // STREAMWEAVER_SECRET, SPMT auth, or Bot Share. This endpoint is intentionally
  // public for normal chatbot conversation. Public callers never receive owner,
  // admin, or moderator authority from request data.
  const body = await request.json().catch(() => null) as any;
  const command = text(body?.command || body?.transcript, 5000);
  const tenantId = text(body?.targetTenantId || body?.tenantId, 128);
  const roomId = text(body?.roomId, 160);
  if (!command || !tenantId || !roomId) {
    return apiError('command, targetTenantId, and roomId are required', { status: 400, code: 'INVALID_REQUEST' });
  }

  const botName = getBotName(tenantId);
  if (isTheCountTwitchLogin(tenantId) || isTheCountName(botName)) {
    return apiError('The Count does not participate in public persona conversations', {
      status: 403,
      code: 'THE_COUNT_CHAT_DISABLED',
    });
  }

  const actorUserId = text(body?.actorUserId, 160) || `hearmeout-room-${roomId}`;
  const actorUsername = text(body?.actorUsername, 100) || 'HearMeOut room';
  const actorDisplayName = text(body?.actorDisplayName, 100) || actorUsername;
  const action = await routeBotAction(command, {
    tenantId,
    botName,
    source: 'hearmeout',
    visibility: 'public',
    message: command,
    requestId: text(body?.requestId, 160) || undefined,
    roomId,
    actor: {
      userId: actorUserId,
      username: actorUsername,
      displayName: actorDisplayName,
      role: 'guest',
    },
  });

  let responseText = action?.response || '';
  let commandType: string | undefined = action?.action;
  if (!responseText) {
    const openCommand = await detectOpenBotCommandWithAi(command, tenantId);
    if (openCommand) {
      responseText = await runOpenBotCommand(openCommand);
      commandType = openCommand;
    }
  }
  if (!responseText) responseText = await conversationalReply({ tenantId, roomId, command });
  if (!responseText) responseText = 'I could not form a response. Please try that again.';

  const sayStreamKey = hearMeOutSayStreamKey(roomId, tenantId);
  const audioDataUri = await generateTTS(
    responseText.slice(0, 2000),
    DEFAULT_TTS_VOICE,
    sayStreamKey,
  ).catch((error) => {
    console.warn(`[HearMeOutPersona:${tenantId}] Say TTS failed:`, error);
    return '';
  });

  return apiOk({
    accepted: true,
    handled: Boolean(action || commandType),
    status: action?.status || 'completed',
    commandType,
    response: responseText,
    bot: { name: botName, tenantId },
    tts: audioDataUri
      ? { ok: true, audioDataUri, source: 'say', streamKey: sayStreamKey, voice: DEFAULT_TTS_VOICE }
      : { ok: false, source: 'say', streamKey: sayStreamKey, voice: DEFAULT_TTS_VOICE },
    roomId,
  });
}
