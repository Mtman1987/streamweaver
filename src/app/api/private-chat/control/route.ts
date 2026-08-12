import { NextRequest } from 'next/server';
import { apiError, apiOk } from '@/lib/api-response';
import { deleteMessage, getDiscordMessage, editDiscordMessage } from '@/services/discord-local';
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
};

function safeError(error: unknown): string {
  return String(error instanceof Error ? error.message : error || 'Control action failed')
    .replace(/https?:\/\/\S+/gi, '[private endpoint]')
    .replace(/bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
}

function ttsMode(value: unknown): 'toggle' | 'poll' | 'off' {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'poll') return 'poll';
  if (normalized === 'off') return 'off';
  return 'toggle';
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

    // Opening the signed speaker link toggles this tenant bot's private listening session.
    const next = await writePrivateChatSettings({ ttsEnabled: !current.ttsEnabled }, tenantId);
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
