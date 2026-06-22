import { NextRequest } from 'next/server';
import { apiError, apiOk } from '@/lib/api-response';
import { appendCommanderMemory, isCommander } from '@/lib/commander-memory';
import { handleTwitchMessage } from '@/services/chat-dispatcher';
import { sendChatMessage } from '@/services/twitch';
import { handleVoiceShoutout } from '@/services/voice-shoutout';
import { startBRB, stopBRB } from '@/services/brb-clips';
import { translateToLanguage, type TargetLanguage } from '@/services/translation';
import { getStoredTokens } from '@/lib/token-utils.server';
import { sendDiscordMessage } from '@/services/discord-local';
import { tenantPath, globalPath } from '@/lib/tenant';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { dirname } from 'path';
import { z } from 'zod';

const mountainViewVoiceSchema = z.object({
  transcript: z.string().trim().min(1).max(5000).optional(),
  message: z.string().trim().min(1).max(5000).optional(),
  destination: z.enum(['ai', 'private', 'twitch', 'discord']).optional().default('ai'),
  wakeWord: z.string().trim().max(64).optional(),
  tenantId: z.string().trim().max(128).optional(),
  username: z.string().trim().max(128).optional(),
  channel: z.string().trim().max(128).optional(),
  dispatch: z.boolean().optional(),
  source: z.string().trim().max(128).optional(),
  voiceMode: z.enum(['reply', 'dictation', 'translation']).optional().default('reply'),
  translation: z.object({
    enabled: z.boolean().optional(),
    language: z.string().trim().max(64).optional(),
  }).optional(),
  payload: z.unknown().optional(),
});

type VoiceTranscriptRecord = {
  id: string;
  createdAt: string;
  transcript: string;
  destination: string;
  source: string;
  username: string;
  tenantId: string;
  wakeWord: string | null;
  dispatched: boolean;
};

function getBaseUrl(request: NextRequest): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL;
  if (configured) return configured.replace(/\/+$/, '');
  return request.nextUrl.origin;
}

async function postJson(url: string, body: unknown): Promise<{ ok: boolean; status: number; data: any; text: string }> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-mountainview-bridge': '1' },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let data: any = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  return { ok: response.ok, status: response.status, data, text };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return '';
}

function targetLanguageFromName(language: string | undefined): TargetLanguage {
  const normalized = String(language || '').trim().toLowerCase();
  if (['french', 'fr', 'francais', 'français'].includes(normalized)) return 'fr';
  if (['russian', 'ru'].includes(normalized)) return 'ru';
  if (['german', 'de', 'deutsch'].includes(normalized)) return 'de';
  if (['japanese', 'ja', 'jp'].includes(normalized)) return 'ja';
  return 'es';
}

async function getBroadcasterUsername(tenantId?: string, fallback = 'mtman1987'): Promise<string> {
  const tokens = await getStoredTokens(tenantId).catch(() => null);
  return tokens?.broadcasterUsername || fallback;
}

async function getDiscordMountainViewChannelId(tenantId?: string, preferred?: string): Promise<string> {
  if (preferred && /^\d+$/.test(preferred)) return preferred;
  if (!tenantId) return '';
  try {
    const config = JSON.parse(await readFile(tenantPath(tenantId, 'tokens/discord-channels.json'), 'utf8'));
    return firstString(config.aiChatChannelId, config.logChannelId, config.dmChannelId, config.shoutoutChannelId);
  } catch {
    return '';
  }
}

async function handleBuiltInVoiceCommand(input: {
  transcript: string;
  tenantId?: string;
  username: string;
}) {
  const lower = input.transcript.trim().toLowerCase();
  const broadcaster = await getBroadcasterUsername(input.tenantId, input.username);

  if (lower.includes('be right back') || lower === 'brb' || lower === '!brb') {
    await startBRB(broadcaster, input.tenantId);
    return { handled: true, type: 'brb-start', response: 'BRB workflow started.' };
  }

  if (lower.includes('back from break') || lower.includes('stop brb') || lower === '!back') {
    stopBRB();
    return { handled: true, type: 'brb-stop', response: 'BRB workflow stopped.' };
  }

  const shoutoutMatch = input.transcript.match(/(?:shout\s*out|shoutout)\s+(.+)/i);
  if (shoutoutMatch) {
    const spokenName = shoutoutMatch[1].trim().replace(/^@/, '');
    if (spokenName) {
      await handleVoiceShoutout(spokenName, input.tenantId);
      return { handled: true, type: 'shoutout', response: `Shoutout triggered for ${spokenName}.` };
    }
  }

  return { handled: false };
}

async function appendVoiceTranscript(record: VoiceTranscriptRecord): Promise<void> {
  const file = record.tenantId && record.tenantId !== 'global'
    ? tenantPath(record.tenantId, 'logs/mountainview-voice-transcripts.json')
    : globalPath('logs/mountainview-voice-transcripts.json');

  let records: VoiceTranscriptRecord[] = [];
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8'));
    records = Array.isArray(parsed) ? parsed : [];
  } catch {}

  records.push(record);
  const trimmed = records.slice(-300);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(trimmed, null, 2), 'utf8');
}

async function dispatchTranscriptToStreamWeaverChat(input: {
  transcript: string;
  tenantId?: string;
  username: string;
  channel?: string;
}) {
  const channel = input.channel || await getBroadcasterUsername(input.tenantId, input.username);
  const tags = {
    id: `mountainview-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    username: input.username,
    'display-name': input.username,
    mod: true,
    badges: { broadcaster: '1' },
    source: 'mountainview-ai',
  };

  await handleTwitchMessage(`#${channel.replace(/^#/, '')}`, tags, input.transcript, false);
  return { channel, tags: { username: tags.username, mod: tags.mod, badges: tags.badges } };
}

async function sendDictation(input: {
  transcript: string;
  destination: 'twitch' | 'discord';
  tenantId?: string;
  username: string;
  channel?: string;
}) {
  if (input.destination === 'twitch') {
    const channel = input.channel || await getBroadcasterUsername(input.tenantId, input.username);
    await sendChatMessage(input.transcript, 'broadcaster', channel, input.tenantId);
    return { platform: 'twitch', channel };
  }

  const channelId = await getDiscordMountainViewChannelId(input.tenantId, input.channel);
  if (!channelId) throw new Error('Discord channel is not configured for MountainView dictation.');
  await sendDiscordMessage(channelId, input.transcript);
  return { platform: 'discord', channelId };
}

async function queueTts(baseUrl: string, reply: string, tenantId?: string) {
  if (!reply) return { queued: false };
  const ttsResult = await postJson(`${baseUrl}/api/tts`, { text: reply, tenantId });
  if (!ttsResult.ok || !ttsResult.data?.audioDataUri) {
    return { queued: false, status: ttsResult.status, error: ttsResult.data?.error || ttsResult.text };
  }
  const query = tenantId ? `?tenant=${encodeURIComponent(tenantId)}` : '';
  const current = await postJson(`${baseUrl}/api/tts/current${query}`, {
    audioUrl: ttsResult.data.audioDataUri,
  });
  return current.ok
    ? { queued: true, status: current.status }
    : { queued: false, status: current.status, error: current.data?.error || current.text };
}

export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.json().catch(() => null);
    const body = typeof rawBody === 'string' ? JSON.parse(rawBody) : rawBody;
    const parsed = mountainViewVoiceSchema.safeParse(body);
    if (!parsed.success) {
      return apiError('Invalid MountainView voice command payload', {
        status: 400,
        code: 'INVALID_BODY',
        details: parsed.error.flatten(),
      });
    }

    const command = parsed.data;
    const transcript = (command.transcript || command.message || '').trim();
    if (!transcript) {
      return apiError('Missing transcript', { status: 400, code: 'MISSING_TRANSCRIPT' });
    }

    const username = command.username || 'mtman1987';
    const tenantId = command.tenantId || undefined;
    const payload = asRecord(command.payload);
    const nestedPayload = asRecord(payload.payload);
    const voiceMode = command.voiceMode || firstString(payload.voiceMode, nestedPayload.voiceMode) || 'reply';
    const translationInput = asRecord(command.translation || payload.translation || nestedPayload.translation);
    const translationEnabled = command.destination === 'twitch' || command.destination === 'discord'
      ? voiceMode === 'translation' || translationInput.enabled === true
      : voiceMode === 'translation';
    const shouldDispatch = command.dispatch === true || payload.dispatch === true;
    const transcriptRecord: VoiceTranscriptRecord = {
      id: `mv_voice_${Date.now()}_${Math.random().toString(16).slice(2)}`,
      createdAt: new Date().toISOString(),
      transcript,
      destination: command.destination,
      source: command.source || String(payload.source || 'mountainview-ai'),
      username,
      tenantId: tenantId || 'global',
      wakeWord: command.wakeWord || null,
      dispatched: shouldDispatch,
    };
    await appendVoiceTranscript(transcriptRecord);
    const baseUrl = getBaseUrl(request);

    const builtIn = await handleBuiltInVoiceCommand({ transcript, tenantId, username });
    if (builtIn.handled) {
      return apiOk({
        routed: true,
        handled: true,
        source: 'mountainview-ai',
        destination: command.destination,
        voiceMode,
        transcript,
        response: builtIn.response,
        command: builtIn.type,
        memory: { saved: true, id: transcriptRecord.id },
      });
    }

    if ((command.destination === 'twitch' || command.destination === 'discord') && (voiceMode === 'dictation' || translationEnabled)) {
      let outgoing = transcript;
      let translation: unknown;
      if (translationEnabled) {
        const targetLanguage = targetLanguageFromName(firstString(translationInput.language, nestedPayload.translationLanguage));
        const result = await translateToLanguage(transcript, targetLanguage);
        outgoing = result.translatedText || transcript;
        translation = result;
      }
      const dispatchResult = await sendDictation({
        transcript: outgoing,
        destination: command.destination,
        tenantId,
        username,
        channel: command.channel || firstString(payload.channel, nestedPayload.channel),
      });

      return apiOk({
        routed: true,
        dispatched: true,
        source: 'mountainview-ai',
        destination: command.destination,
        voiceMode,
        transcript,
        outgoing,
        translation,
        dispatch: dispatchResult,
        memory: { saved: true, id: transcriptRecord.id },
      });
    }

    if (shouldDispatch) {
      const dispatchResult = await dispatchTranscriptToStreamWeaverChat({
        transcript,
        tenantId,
        username,
        channel: command.channel || String(payload.channel || ''),
      });

      return apiOk({
        routed: true,
        dispatched: true,
        source: 'mountainview-ai',
        destination: command.destination,
        voiceMode,
        wakeWord: command.wakeWord || null,
        transcript,
        dispatch: dispatchResult,
        memory: { saved: true, id: transcriptRecord.id },
      });
    }

    if (command.destination === 'private') {
      const privateChat = await postJson(`${baseUrl}/api/private-chat/respond`, {
        username,
        message: transcript,
        tenantId,
        historyLimit: 30,
      });

      if (!privateChat.ok) {
        return apiOk({
          routed: false,
          source: 'mountainview-ai',
          destination: command.destination,
          voiceMode,
          transcript,
          aiStatus: privateChat.status,
          error: privateChat.data?.error || privateChat.text || 'StreamWeaver private chat route failed',
        });
      }

      const reply = String(privateChat.data?.response || privateChat.data?.data?.response || '').trim();
      const tts = await queueTts(baseUrl, reply, tenantId);

      return apiOk({
        routed: true,
        source: 'mountainview-ai',
        destination: command.destination,
        voiceMode,
        transcript,
        response: reply,
        tts,
      });
    }

    const context = command.destination === 'discord' ? 'discord' : 'voice';

    const ai = await postJson(`${baseUrl}/api/ai/chat-with-memory`, {
      username,
      message: transcript,
      tenantId,
      context,
    });

    if (!ai.ok) {
      return apiOk({
        routed: false,
        source: 'mountainview-ai',
        destination: command.destination,
        voiceMode,
        transcript,
        aiStatus: ai.status,
        error: ai.data?.error || ai.text || 'StreamWeaver AI route failed',
      });
    }

    const reply = String(ai.data?.response || '').trim();
    let chatDispatch: Record<string, unknown> | undefined;
    if (reply && (command.destination === 'twitch' || command.destination === 'discord')) {
      if (command.destination === 'twitch') {
        await sendChatMessage(transcript, 'broadcaster', command.channel || firstString(payload.channel, nestedPayload.channel) || await getBroadcasterUsername(tenantId, username), tenantId);
        await sendChatMessage(reply.slice(0, 450), 'bot', command.channel || firstString(payload.channel, nestedPayload.channel) || await getBroadcasterUsername(tenantId, username), tenantId);
        chatDispatch = { platform: 'twitch', sentUserMessage: true, sentAiReply: true };
      } else {
        const channelId = await getDiscordMountainViewChannelId(tenantId, command.channel || firstString(payload.channel, nestedPayload.channel));
        if (channelId) {
          await sendDiscordMessage(channelId, `${username}: ${transcript}`);
          await sendDiscordMessage(channelId, reply.slice(0, 1800));
          chatDispatch = { platform: 'discord', channelId, sentUserMessage: true, sentAiReply: true };
        } else {
          chatDispatch = { platform: 'discord', sentUserMessage: false, sentAiReply: false, error: 'No Discord channel configured' };
        }
      }
    }
    const tts = await queueTts(baseUrl, reply, tenantId);

    if (isCommander(username)) {
      await appendCommanderMemory({
        botName: 'MountainView AI',
        tenantId: tenantId || 'global',
        message: transcript,
        response: reply || '(no response)',
        timestamp: new Date().toISOString(),
      });
    }

    return apiOk({
      routed: true,
      source: 'mountainview-ai',
      destination: command.destination,
      voiceMode,
      wakeWord: command.wakeWord || null,
      transcript,
      response: reply,
      dispatch: chatDispatch,
      tts,
    });
  } catch (error) {
    console.error('[MountainView Voice Commander] route failed:', error);
    return apiError('MountainView voice commander failed', { status: 500, code: 'INTERNAL_ERROR' });
  }
}
