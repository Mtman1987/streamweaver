import { NextRequest } from 'next/server';
import { apiError, apiOk } from '@/lib/api-response';
import { bootstrapTenant } from '@/lib/tenant';
import { serializeSessionCookie } from '@/lib/session-cookie';
import { detectOpenBotCommandWithAi, runOpenBotCommand } from '@/services/open-bot-commands';
import { getBotName } from '@/lib/bot-settings-store';
import { routeBotAction, type BotActionSource } from '@/services/bot-action-runtime';
import { generateTTS } from '@/services/tts-provider';
import { DEFAULT_TTS_VOICE } from '@/lib/tts-voices';
import { isTheCountName, isTheCountTwitchLogin } from '@/lib/the-count';

const SPMT_BASE_URL = String(process.env.SPMT_BASE_URL || 'https://spmt.live').replace(/\/$/, '');

type SpmtUser = {
  id: string;
  username: string;
  displayName?: string;
  display_name?: string;
  avatarUrl?: string;
  avatar_url?: string;
  twitchId?: string;
  twitch_id?: string;
  twitchUsername?: string;
  twitch_username?: string;
};

function bearerToken(request: NextRequest): string {
  const header = String(request.headers.get('authorization') || '').trim();
  return /^Bearer\s+/i.test(header) ? header.replace(/^Bearer\s+/i, '').trim() : '';
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    const normalized = String(value || '').trim();
    if (normalized) return normalized;
  }
  return '';
}

function botActionSource(value: unknown): BotActionSource {
  const source = firstString(value).toLowerCase();
  if (source === 'hearmeout' || source.startsWith('hearmeout-')) return 'hearmeout';
  if (source === 'discord' || source === 'twitch' || source === 'kick' || source === 'mountainview') {
    return source;
  }
  return 'spmt';
}

function hearMeOutSayStreamKey(roomId: unknown, personaTenantId: unknown): string {
  const clean = (value: unknown, fallback: string) => (
    firstString(value)
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || fallback
  );
  const room = clean(roomId, 'room');
  const persona = clean(personaTenantId, 'persona');
  return `hmo-say-${room}-${persona}`.slice(0, 128);
}

async function resolveSpmtUser(token: string): Promise<SpmtUser | null> {
  const response = await fetch(`${SPMT_BASE_URL}/api/oauth/userinfo`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    cache: 'no-store',
    signal: typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(8000) : undefined,
  }).catch(() => null);
  if (!response?.ok) return null;
  const payload = await response.json().catch(() => null) as any;
  const user = payload?.user || payload?.profile || payload;
  if (!user?.id || !user?.username) return null;
  return user as SpmtUser;
}

function internalSessionCookie(user: SpmtUser, tenantOverride?: string) {
  const ownerTenantId = firstString(user.twitchId, user.twitch_id, user.id);
  const tenantId = firstString(tenantOverride, ownerTenantId);
  const username = firstString(user.twitchUsername, user.twitch_username, user.username);
  const displayName = firstString(user.displayName, user.display_name, username);
  const avatar = firstString(user.avatarUrl, user.avatar_url);
  const value = serializeSessionCookie({
    id: tenantId,
    spmtUserId: user.id,
    identityProvider: 'spmt',
    username,
    displayName,
    avatar,
    loginTime: Date.now(),
  });
  return {
    tenantId,
    ownerTenantId,
    username,
    displayName,
    header: `streamweaver-session=${encodeURIComponent(value)}`,
  };
}

function internalBaseUrl(): string {
  const port = String(process.env.PORT || '3000').trim() || '3000';
  return `http://127.0.0.1:${port}`;
}

async function postInternal(_request: NextRequest, path: string, cookie: string, token: string, body: unknown) {
  const response = await fetch(new URL(path, internalBaseUrl()), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Cookie: cookie,
    },
    body: JSON.stringify(body),
    cache: 'no-store',
    signal: typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(45000) : undefined,
  });
  const text = await response.text();
  let data: any = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  return { ok: response.ok, status: response.status, data, text };
}

async function maybeGenerateTts(
  tenantId: string,
  responseText: string,
  body: any,
) {
  if (!responseText || body?.speak === false) return null;

  const source = botActionSource(body?.source || body?.sourceApp);
  const useHearMeOutSay = source === 'hearmeout';
  const sayStreamKey = useHearMeOutSay
    ? hearMeOutSayStreamKey(body?.roomId, tenantId)
    : '';
  const synthesisTenantId = useHearMeOutSay ? sayStreamKey : tenantId;
  const synthesisVoice = useHearMeOutSay
    ? DEFAULT_TTS_VOICE
    : firstString(body?.voice) || undefined;

  try {
    const audioDataUri = await generateTTS(
      responseText.slice(0, 2000),
      synthesisVoice,
      synthesisTenantId,
    );
    if (!audioDataUri) {
      return {
        ok: false,
        error: 'TTS returned no audio payload',
        source: useHearMeOutSay ? 'say' : 'direct',
        streamKey: sayStreamKey || undefined,
        voice: synthesisVoice,
      };
    }
    return {
      ok: true,
      audioDataUri,
      source: useHearMeOutSay ? 'say' : 'direct',
      streamKey: sayStreamKey || undefined,
      voice: synthesisVoice,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(
      `[SPMT Bot:${tenantId}] ${useHearMeOutSay ? 'HearMeOut Say' : 'Direct'} TTS generation failed:`,
      message,
    );
    return {
      ok: false,
      error: message,
      source: useHearMeOutSay ? 'say' : 'direct',
      streamKey: sayStreamKey || undefined,
      voice: synthesisVoice,
    };
  }
}

export async function POST(request: NextRequest) {
  const token = bearerToken(request);
  if (!token) {
    return apiError('SPMT authentication required', { status: 401, code: 'SPMT_AUTH_REQUIRED' });
  }

  const user = await resolveSpmtUser(token);
  if (!user) {
    return apiError('SPMT session is invalid or expired', { status: 401, code: 'SPMT_AUTH_INVALID' });
  }

  const body = await request.json().catch(() => null) as any;
  const command = firstString(body?.command, body?.message, body?.transcript).slice(0, 5000);
  if (!command) {
    return apiError('command is required', { status: 400, code: 'COMMAND_REQUIRED' });
  }

  const caller = internalSessionCookie(user);
  await bootstrapTenant(caller.tenantId, caller.username);

  const requestedTargetTenantId = firstString(body?.targetTenantId).slice(0, 128);
  const targetTenantId = requestedTargetTenantId || caller.tenantId;
  const isGuestBot = targetTenantId !== caller.tenantId;
  const actionSource = botActionSource(body?.source || body?.sourceApp);
  const botName = getBotName(targetTenantId);

  if (isGuestBot && (isTheCountTwitchLogin(targetTenantId) || isTheCountName(botName))) {
    return apiError('The Count does not participate in public persona conversations', {
      status: 403,
      code: 'THE_COUNT_CHAT_DISABLED',
    });
  }

  // GLOBAL INVARIANT: Bot Share is irrelevant here because this request was
  // issued by a human. Turning Bot Share off must never prevent a bot from
  // answering a human, following a permitted human command, or running a
  // permitted human trigger on Discord, Twitch, Kick, TikTok, HearMeOut, SPMT,
  // or any future platform.
  const session = internalSessionCookie(user, targetTenantId);

  const actionOutcome = await routeBotAction(command, {
    tenantId: targetTenantId,
    botName,
    source: actionSource,
    visibility: isGuestBot || actionSource === 'hearmeout' ? 'public' : 'private',
    message: command,
    requestId: firstString(body?.requestId, body?.messageId),
    guildId: firstString(body?.guildId, body?.serverId),
    roomId: firstString(body?.roomId),
    actor: {
      userId: user.id,
      username: caller.username,
      displayName: caller.displayName,
      role: isGuestBot ? 'member' : 'owner',
    },
  });
  if (actionOutcome) {
    const tts = await maybeGenerateTts(targetTenantId, actionOutcome.response, body);
    return apiOk({
      accepted: true,
      routed: true,
      handled: true,
      status: actionOutcome.status,
      command,
      commandType: actionOutcome.action,
      response: actionOutcome.response,
      result: actionOutcome.result,
      bot: { name: botName, tenantId: targetTenantId },
      tts,
      identity: {
        spmtUserId: user.id,
        tenantId: caller.tenantId,
        username: caller.username,
        displayName: caller.displayName,
      },
      source: firstString(body?.source, body?.sourceApp) || 'spmt-bot',
      roomId: firstString(body?.roomId) || undefined,
    });
  }

  const openCommand = await detectOpenBotCommandWithAi(command, targetTenantId);
  if (openCommand) {
    try {
      const responseText = await runOpenBotCommand(openCommand);
      const tts = await maybeGenerateTts(targetTenantId, responseText, body);
      return apiOk({
        accepted: true,
        routed: true,
        handled: true,
        status: 'completed',
        command,
        commandType: openCommand,
        response: responseText,
        bot: { name: botName, tenantId: targetTenantId },
        tts,
        identity: {
          spmtUserId: user.id,
          tenantId: caller.tenantId,
          username: caller.username,
          displayName: caller.displayName,
        },
        source: firstString(body?.source, body?.sourceApp) || 'spmt-bot',
        roomId: firstString(body?.roomId) || undefined,
      });
    } catch (error) {
      console.warn(`[SPMT Bot:${targetTenantId}] Shared command ${openCommand} failed; falling through to conversational AI:`, error);
    }
  }

  const aiUsername = isGuestBot ? `human:${caller.username}` : caller.username;
  const ai = await postInternal(request, '/api/ai/chat-with-memory', session.header, token, {
    username: aiUsername,
    userId: user.id,
    displayName: caller.displayName,
    message: command,
    tenantId: targetTenantId,
    context: isGuestBot ? 'public-human-to-bot' : 'voice',
  });

  if (!ai.ok) {
    return apiError(
      String(ai.data?.error?.message || ai.data?.error || ai.text || 'StreamWeaver bot runtime failed'),
      { status: ai.status >= 400 && ai.status < 600 ? ai.status : 502, code: 'BOT_UPSTREAM_FAILED' },
    );
  }

  const responseText = firstString(ai.data?.response, ai.data?.data?.response);
  const tts = await maybeGenerateTts(targetTenantId, responseText, body);

  return apiOk({
    accepted: true,
    routed: true,
    handled: false,
    status: 'completed',
    command,
    response: responseText,
    research: ai.data?.research || ai.data?.data?.research || undefined,
    bot: { name: botName, tenantId: targetTenantId },
    tts,
    identity: {
      spmtUserId: user.id,
      tenantId: caller.tenantId,
      username: caller.username,
      displayName: caller.displayName,
    },
    source: firstString(body?.source, body?.sourceApp) || 'spmt-bot',
    roomId: firstString(body?.roomId) || undefined,
  });
}
