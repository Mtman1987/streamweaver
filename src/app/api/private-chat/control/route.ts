import { NextRequest } from 'next/server';
import { apiError, apiOk } from '@/lib/api-response';
import { getDiscordMessage, editDiscordMessage } from '@/services/discord-local';
import {
  parsePrivateDmControlAction,
  privateDmMessageText,
  resolvePrivateDmMediaUrl,
  resolvePrivateDmTenantId,
  splitPrivateTtsText,
  togglePrivateDmGif,
  verifyPrivateDmControlToken,
} from '@/services/private-dm-controls';
import {
  readPrivateChatSettings,
  writePrivateChatSettings,
} from '@/lib/private-chat-settings-store';
import { generateTTS } from '@/services/tts-provider';

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
      return apiOk({ action, redirectUrl: '/bot-functions' });
    }

    if (action === 'adult') {
      const current = await readPrivateChatSettings(tenantId);
      const next = await writePrivateChatSettings({ adultMode: !current.adultMode }, tenantId);
      return apiOk({
        action,
        adultMode: next.adultMode,
        message: `Adult Mode is now ${next.adultMode ? 'ON' : 'OFF'} for private DMs.`,
      });
    }

    const message = await getDiscordMessage(control.channelId, control.messageId) as any;

    if (action === 'gif') {
      const currentEmbeds = Array.isArray(message?.embeds) ? message.embeds : [];
      const result = togglePrivateDmGif(currentEmbeds, resolvePrivateDmMediaUrl(tenantId));
      await editDiscordMessage(control.channelId, control.messageId, { embeds: result.embeds });
      return apiOk({
        action,
        visible: result.visible,
        message: `Private GIF is now ${result.visible ? 'visible' : 'hidden'} on that Discord reply.`,
      });
    }

    const text = privateDmMessageText(message);
    const chunks = splitPrivateTtsText(text);
    if (!chunks.length) {
      return apiError('That private Discord reply has no text to read.', {
        status: 400,
        code: 'NO_PRIVATE_TTS_TEXT',
      });
    }

    const audioDataUris: string[] = [];
    for (const chunk of chunks) {
      const audioDataUri = await generateTTS(chunk, undefined, tenantId);
      if (audioDataUri) audioDataUris.push(audioDataUri);
    }
    if (!audioDataUris.length) {
      return apiError('Private TTS returned no audio.', {
        status: 502,
        code: 'PRIVATE_TTS_EMPTY',
      });
    }

    return apiOk({
      action,
      audioDataUris,
      chunkCount: audioDataUris.length,
      message: audioDataUris.length === 1
        ? 'Private TTS is ready.'
        : `Private TTS is ready in ${audioDataUris.length} parts.`,
    });
  } catch (error) {
    console.error('[Private DM Control] Action failed:', action, error);
    return apiError(safeError(error), {
      status: 500,
      code: 'PRIVATE_CONTROL_FAILED',
    });
  }
}
