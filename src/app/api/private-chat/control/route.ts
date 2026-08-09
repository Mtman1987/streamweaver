import { NextRequest } from 'next/server';
import { apiError, apiOk } from '@/lib/api-response';
import { getDiscordMessage, editDiscordMessage } from '@/services/discord-local';
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
import { generateTTS } from '@/services/tts-provider';
import { restartPrivateImageCarousel } from '@/services/private-image-carousel';

export const dynamic = 'force-dynamic';

function safeError(error: unknown): string {
  return String(error instanceof Error ? error.message : error || 'Control action failed')
    .replace(/https?:\/\/\S+/gi, '[private endpoint]')
    .replace(/bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as { token?: unknown; action?: unknown } | null;
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

  try {
    if (action === 'settings') {
      return apiOk({ action, redirectUrl: '/private-chat' });
    }

    const current = await readPrivateChatSettings(tenantId);

    if (action === 'adult') {
      const next = await writePrivateChatSettings({ adultMode: !current.adultMode }, tenantId);
      // Edit the embed icon to reflect new state
      try {
        const message = await getDiscordMessage(control.channelId, control.messageId) as any;
        const currentEmbeds = Array.isArray(message?.embeds) ? message.embeds : [];
        if (currentEmbeds.length) {
          const updatedEmbeds = attachPrivateDmControls(currentEmbeds, {
            channelId: control.channelId,
            messageId: control.messageId,
            gifEnabled: next.gifEnabled,
            ttsEnabled: next.ttsEnabled,
            adultMode: next.adultMode,
          });
          await editDiscordMessage(control.channelId, control.messageId, { embeds: updatedEmbeds });
        }
      } catch {
        // Icon update is best-effort; don't fail the toggle
      }
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
      // Apply gif visibility based on new setting
      let updatedEmbeds = applyPrivateDmGif(currentEmbeds, mediaUrl, next.gifEnabled);
      // Rebuild control field with updated icons
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

    // TTS: toggle persistent setting, update icon, return audio for current message
    const next = await writePrivateChatSettings({ ttsEnabled: !current.ttsEnabled }, tenantId);
    // Update icon on the embed
    try {
      const message = await getDiscordMessage(control.channelId, control.messageId) as any;
      const currentEmbeds = Array.isArray(message?.embeds) ? message.embeds : [];
      if (currentEmbeds.length) {
        const updatedEmbeds = attachPrivateDmControls(currentEmbeds, {
          channelId: control.channelId,
          messageId: control.messageId,
          gifEnabled: next.gifEnabled,
          ttsEnabled: next.ttsEnabled,
          adultMode: next.adultMode,
        });
        await editDiscordMessage(control.channelId, control.messageId, { embeds: updatedEmbeds });
      }
    } catch {
      // Icon update is best-effort
    }

    if (!next.ttsEnabled) {
      return apiOk({
        action,
        ttsEnabled: false,
        message: 'Private TTS is now OFF.',
      });
    }

    // TTS just turned on — read and speak the current message
    const discordMessage = await getDiscordMessage(control.channelId, control.messageId) as any;
    const text = privateDmMessageText(discordMessage);
    const chunks = splitPrivateTtsText(text);
    if (!chunks.length) {
      return apiOk({ action, ttsEnabled: true, message: 'Private TTS is ON. No text to read on this message.' });
    }

    const audioDataUris: string[] = [];
    for (const chunk of chunks) {
      const audioDataUri = await generateTTS(chunk, undefined, tenantId);
      if (audioDataUri) audioDataUris.push(audioDataUri);
    }

    return apiOk({
      action,
      ttsEnabled: true,
      audioDataUris,
      chunkCount: audioDataUris.length,
      message: audioDataUris.length
        ? `Private TTS is ON. ${audioDataUris.length === 1 ? 'Audio ready.' : `${audioDataUris.length} parts ready.`}`
        : 'Private TTS is ON.',
    });
  } catch (error) {
    console.error('[Private DM Control] Action failed:', action, error);
    return apiError(safeError(error), {
      status: 500,
      code: 'PRIVATE_CONTROL_FAILED',
    });
  }
}
