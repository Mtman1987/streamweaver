import { NextRequest } from 'next/server';
import { apiError, apiOk } from '@/lib/api-response';
import { deleteMessage, getDiscordMessage, editDiscordMessage, getChannelMessages } from '@/services/discord-local';
import { deletePrivateChatAiMessage } from '@/lib/private-chat-store';
import {
  applyPrivateDmGif,
  attachPrivateDmControls,
  parsePrivateDmControlAction,
  privateDmMessageText,
  resolvePrivateDmMediaUrl,
  resolvePrivateDmTenantId,
  splitPrivateTtsText,
  verifyPrivateDmControlToken,
} from '@/services/private-dm-controls';
import {
  readPrivateChatSettings,
  writePrivateChatSettings,
} from '@/lib/private-chat-settings-store';
import { readPrivateChatMessages } from '@/lib/private-chat-store';
import { getBotName } from '@/lib/bot-settings-store';
import { TTS_VOICE_OPTIONS } from '@/lib/tts-voices';
import { readAICostPolicy } from '@/services/ai-cost-policy';
import { buildDiscordUserAvatarUrl } from '@/services/discord-branding';
import { getInternalAppUrl } from '@/lib/runtime-origin';
import { internalServiceHeaders } from '@/lib/internal-service-auth';
import { sendStructuredDiscordReply } from '@/services/discord-structured-replies';
import { generateTTS } from '@/services/tts-provider';
import { restartPrivateImageCarousel } from '@/services/private-image-carousel';
import {
  findPrivateAiCursorByText,
  latestPrivateAiCursor,
  listPrivateAiTurnsAfter,
} from '@/services/private-dm-live-tts';

export const dynamic = 'force-dynamic';

type PrivateControlBody = {
  token?: unknown;
  action?: unknown;
  mode?: unknown;
  after?: unknown;
  voice?: unknown;
  message?: unknown;
};

function safeError(error: unknown): string {
  return String(error instanceof Error ? error.message : error || 'Control action failed')
    .replace(/https?:\/\/\S+/gi, '[private endpoint]')
    .replace(/bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
}

function ttsMode(value: unknown): 'toggle' | 'poll' | 'off' | 'on' | 'send' | 'test' {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'poll') return 'poll';
  if (normalized === 'off') return 'off';
  if (normalized === 'on' || normalized === 'start') return 'on';
  if (normalized === 'send') return 'send';
  if (normalized === 'test') return 'test';
  return 'toggle';
}

function privateVoiceCatalog() {
  const policy = readAICostPolicy();
  const voices = policy.paidRoutesEnabled
    ? TTS_VOICE_OPTIONS
    : TTS_VOICE_OPTIONS.filter((voice) => (
        voice.provider === 'kokoro' ||
        (voice.provider === 'gemini' && policy.geminiFreeTierVerified)
      ));
  return voices.map((voice) => ({
    id: voice.id,
    label: voice.label,
    providerLabel: voice.providerLabel,
    description: voice.description,
  }));
}

function voiceOverride(value: unknown): string | undefined {
  const normalized = String(value || '').trim();
  return normalized ? normalized.slice(0, 128) : undefined;
}

async function generatePrivateAudio(
  text: string,
  tenantId: string,
  voice?: string,
): Promise<string[]> {
  const audioDataUris: string[] = [];
  for (const chunk of splitPrivateTtsText(text)) {
    const audioDataUri = await generateTTS(chunk, voice, tenantId);
    if (audioDataUri) audioDataUris.push(audioDataUri);
  }
  return audioDataUris;
}

async function updateControlIcons(input: {
  channelId: string;
  messageId: string;
  gifEnabled: boolean;
  ttsEnabled: boolean;
  adultMode: boolean;
}): Promise<void> {
  try {
    const message = await getDiscordMessage(input.channelId, input.messageId) as any;
    const currentEmbeds = Array.isArray(message?.embeds) ? message.embeds : [];
    if (!currentEmbeds.length) return;
    const updatedEmbeds = attachPrivateDmControls(currentEmbeds, input);
    await editDiscordMessage(input.channelId, input.messageId, { embeds: updatedEmbeds });
  } catch {
    // The private action remains valid even if Discord cannot refresh the icon strip.
  }
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as PrivateControlBody | null;
  const token = String(body?.token || '').trim();
  const action = parsePrivateDmControlAction(body?.action);
  const control = verifyPrivateDmControlToken(token);
  if (!control || !action) {
    return apiError('This private control link is invalid or expired.', {
      status: 401,
      code: 'INVALID_PRIVATE_CONTROL',
    });
  }

  const tenantId = await resolvePrivateDmTenantId(control.channelId);
  if (!tenantId) {
    return apiError('The private Discord channel is no longer connected to a StreamWeaver account.', {
      status: 404,
      code: 'PRIVATE_CHANNEL_NOT_FOUND',
    });
  }
  const botName = getBotName(tenantId) || 'Your bot';

  try {
    if (action === 'settings') {
      return apiOk({ action, redirectUrl: '/private-chat' });
    }

    if (action === 'delete') {
      const discordMessage = await getDiscordMessage(control.channelId, control.messageId);
      const text = privateDmMessageText(discordMessage);
      const historyDeleted = text
        ? await deletePrivateChatAiMessage(text, tenantId)
        : false;
      await deleteMessage(control.channelId, control.messageId);
      return apiOk({
        action,
        deleted: true,
        historyDeleted,
        message: historyDeleted
          ? `Private DM deleted from Discord and ${botName}'s private history.`
          : 'Private DM deleted from Discord.',
      });
    }

    const current = await readPrivateChatSettings(tenantId);

    if (action === 'adult') {
      const next = await writePrivateChatSettings({ adultMode: !current.adultMode }, tenantId);
      await updateControlIcons({
        channelId: control.channelId,
        messageId: control.messageId,
        gifEnabled: next.gifEnabled,
        ttsEnabled: next.ttsEnabled,
        adultMode: next.adultMode,
      });
      return apiOk({
        action,
        adultMode: next.adultMode,
        message: `Adult Mode is now ${next.adultMode ? 'ON' : 'OFF'} for private DMs.`,
      });
    }

    if (action === 'gif') {
      const carouselRestarted = await restartPrivateImageCarousel({
        tenantId,
        channelId: control.channelId,
        messageId: control.messageId,
      });
      if (carouselRestarted) {
        return apiOk({
          action,
          carouselRestarted: true,
          message: 'Image slideshow restarted. Each image displays for 60 seconds.',
        });
      }
      const next = await writePrivateChatSettings({ gifEnabled: !current.gifEnabled }, tenantId);
      const message = await getDiscordMessage(control.channelId, control.messageId) as any;
      const currentEmbeds = Array.isArray(message?.embeds) ? message.embeds : [];
      const mediaUrl = resolvePrivateDmMediaUrl(tenantId);
      let updatedEmbeds = applyPrivateDmGif(currentEmbeds, mediaUrl, next.gifEnabled);
      updatedEmbeds = attachPrivateDmControls(updatedEmbeds, {
        channelId: control.channelId,
        messageId: control.messageId,
        gifEnabled: next.gifEnabled,
        ttsEnabled: next.ttsEnabled,
        adultMode: next.adultMode,
      });
      await editDiscordMessage(control.channelId, control.messageId, { embeds: updatedEmbeds });
      return apiOk({
        action,
        gifEnabled: next.gifEnabled,
        message: `Private GIF is now ${next.gifEnabled ? 'visible' : 'hidden'}.`,
      });
    }

    const mode = ttsMode(body?.mode);
    const selectedVoice = voiceOverride(body?.voice);

    if (mode === 'send') {
      const transcript = String(body?.message || '').trim().slice(0, 2000);
      if (!transcript) {
        return apiError('Please speak or type a message before sending.', { status: 400, code: 'EMPTY_PRIVATE_TRANSCRIPT' });
      }

      // Reuse the linked reply's footer identity, then refresh it from Discord's
      // actual DM authors when possible. The transcript itself is never posted as
      // a separate Discord message; it is used privately and rendered in the reply footer.
      const linkedMessage = await getDiscordMessage(control.channelId, control.messageId) as any;
      const linkedEmbed = Array.isArray(linkedMessage?.embeds) ? linkedMessage.embeds[0] : null;
      const linkedFooter = linkedEmbed?.footer || {};
      const footerMatch = String(linkedFooter.text || '').match(/^Requested by\s+([^•]+)/i);
      let sourceUser = String(footerMatch?.[1] || '').trim() || 'You';
      let sourceUserAvatarUrl = String(linkedFooter.icon_url || '').trim();

      try {
        const dmMessages = await getChannelMessages(control.channelId, 20) as any;
        const latestHuman = Array.isArray(dmMessages)
          ? dmMessages.find((item) => item?.author?.id && item.author.bot !== true)
          : null;
        const author = latestHuman?.author;
        if (author) {
          sourceUser = String(author.global_name || author.globalName || author.username || sourceUser).trim();
          sourceUserAvatarUrl = buildDiscordUserAvatarUrl(String(author.id || ''), author.avatar) || sourceUserAvatarUrl;
        }
      } catch {
        // Signed DM control + the existing private embed footer are a safe fallback.
      }

      const privateResponse = await fetch(`${getInternalAppUrl()}/api/private-chat/respond`, {
        method: 'POST',
        headers: internalServiceHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          username: sourceUser,
          message: transcript,
          tenantId,
          historyLimit: 30,
        }),
        signal: AbortSignal.timeout(120_000),
      });
      if (!privateResponse.ok) {
        console.warn('[Private DM TTS] Private response generation failed:', privateResponse.status);
        return apiError('Athena could not generate a reply. Your transcript has not been sent to Discord.', {
          status: 502,
          code: 'PRIVATE_REPLY_FAILED',
        });
      }
      const privateData = await privateResponse.json().catch(() => ({}));
      const privateResult = privateData?.data || privateData;
      if (privateResult?.available === false || privateResult?.provider === 'paused') {
        return apiError('Private AI is paused right now. Your transcript was saved to private history, but no Discord reply was sent.', {
          status: 503,
          code: 'PRIVATE_AI_PAUSED',
        });
      }
      const reply = String(privateResult?.response || '').trim();
      if (!reply) {
        return apiError('Athena returned an empty reply. The transcript was not posted to Discord.', {
          status: 502,
          code: 'EMPTY_PRIVATE_REPLY',
        });
      }

      const sent = await sendStructuredDiscordReply({
        channelId: control.channelId,
        message: reply,
        tenantId,
        botName,
        responseType: 'AI Answer',
        sourceMessage: transcript,
        sourceUser,
        sourceUserAvatarUrl,
        isPrivate: true,
        gifEnabled: current.gifEnabled,
        ttsEnabled: current.ttsEnabled,
        adultMode: current.adultMode,
      });

      const updatedHistory = await readPrivateChatMessages(60, tenantId);
      const cursor = findPrivateAiCursorByText(updatedHistory, reply) || latestPrivateAiCursor(updatedHistory);
      let audioDataUris: string[] = [];
      if (current.ttsEnabled) {
        try {
          audioDataUris = await generatePrivateAudio(reply, tenantId, selectedVoice);
        } catch (error) {
          console.warn('[Private DM TTS] Immediate speech generation failed; private reply was delivered.', safeError(error));
        }
      }
      let currentEmbed: any = null;
      if (sent.messageId) {
        try {
          const sentMessage = await getDiscordMessage(control.channelId, sent.messageId) as any;
          currentEmbed = Array.isArray(sentMessage?.embeds) ? sentMessage.embeds[0] || null : null;
        } catch {}
      }

      return apiOk({
        action,
        submitted: true,
        botName,
        reply,
        cursor,
        audioDataUris,
        currentEmbed,
        mediaUrl: current.gifEnabled ? resolvePrivateDmMediaUrl(tenantId) : '',
        message: `${botName} replied privately. Your transcript was included in the reply footer, not sent as a separate DM.`,
      });
    }

    if (mode === 'test') {
      try {
        const audioDataUris = await generatePrivateAudio('This is your private TTS voice test. If you can hear this, playback is working.', tenantId, selectedVoice);
        if (!audioDataUris.length) {
          return apiError('The speech worker returned no audio. Check the local voice worker health.', {
            status: 502,
            code: 'PRIVATE_TTS_EMPTY_AUDIO',
          });
        }
        return apiOk({
          action,
          ttsEnabled: current.ttsEnabled,
          audioDataUris,
          message: 'Voice test audio generated. Tap Play / Resume if your browser blocks playback.',
        });
      } catch (error) {
        return apiError('Private TTS could not generate speech: ' + safeError(error), {
          status: 502,
          code: 'PRIVATE_TTS_GENERATION_FAILED',
        });
      }
    }

    if (mode === 'off') {
      const next = current.ttsEnabled
        ? await writePrivateChatSettings({ ttsEnabled: false }, tenantId)
        : current;
      await updateControlIcons({
        channelId: control.channelId,
        messageId: control.messageId,
        gifEnabled: next.gifEnabled,
        ttsEnabled: false,
        adultMode: next.adultMode,
      });
      return apiOk({ action, ttsEnabled: false, message: `Private ${botName} TTS is OFF.` });
    }

    if (mode === 'poll') {
      if (!current.ttsEnabled) {
        return apiOk({
          action,
          ttsEnabled: false,
          cursor: Math.max(0, Number(body?.after) || 0),
          items: [],
          message: `Private ${botName} TTS is OFF.`,
        });
      }

      const after = Math.max(0, Number(body?.after) || 0);
      const history = await readPrivateChatMessages(60, tenantId);
      const turns = listPrivateAiTurnsAfter(history, after, 4);
      const items = [] as Array<{
        cursor: number;
        text: string;
        question: string;
        timestamp: string;
        audioDataUris: string[];
      }>;

      for (const turn of turns) {
        items.push({
          ...turn,
          audioDataUris: await generatePrivateAudio(turn.text, tenantId, selectedVoice),
        });
      }

      return apiOk({
        action,
        ttsEnabled: true,
        botName,
        mediaUrl: current.gifEnabled ? resolvePrivateDmMediaUrl(tenantId) : '',
        cursor: items.at(-1)?.cursor || after,
        items,
        message: items.length ? `New ${botName} reply ready.` : `Listening for ${botName} replies…`,
      });
    }

    // Opening the signed speaker link uses an idempotent start; a second tab must never turn audio off.
    const next = mode === 'on'
      ? (current.ttsEnabled ? current : await writePrivateChatSettings({ ttsEnabled: true }, tenantId))
      : await writePrivateChatSettings({ ttsEnabled: !current.ttsEnabled }, tenantId);
    await updateControlIcons({
      channelId: control.channelId,
      messageId: control.messageId,
      gifEnabled: next.gifEnabled,
      ttsEnabled: next.ttsEnabled,
      adultMode: next.adultMode,
    });

    if (!next.ttsEnabled) {
      return apiOk({
        action,
        ttsEnabled: false,
        message: `Private ${botName} TTS is now OFF.`,
      });
    }

    const discordMessage = await getDiscordMessage(control.channelId, control.messageId) as any;
    const text = privateDmMessageText(discordMessage);
    const history = await readPrivateChatMessages(60, tenantId);
    const matchedCursor = findPrivateAiCursorByText(history, text);
    const cursor = matchedCursor || latestPrivateAiCursor(history);
    const audioDataUris = text
      ? await generatePrivateAudio(text, tenantId, selectedVoice)
      : [];

    return apiOk({
      action,
      ttsEnabled: true,
      tenantId,
      botName,
      voices: privateVoiceCatalog(),
      cursor,
      currentText: text,
      currentEmbed: Array.isArray(discordMessage?.embeds) ? (discordMessage.embeds[0] || null) : null,
      mediaUrl: next.gifEnabled ? resolvePrivateDmMediaUrl(tenantId) : '',
      audioDataUris,
      chunkCount: audioDataUris.length,
      message: `Private ${botName} TTS is ON. This page will read ${botName} replies until you stop it or close the page.`,
    });
  } catch (error) {
    console.error('[Private DM Control] Action failed:', action, error);
    return apiError(safeError(error), {
      status: 500,
      code: 'PRIVATE_CONTROL_FAILED',
    });
  }
}
