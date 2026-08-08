import { NextRequest } from 'next/server';
import { apiError, apiOk } from '@/lib/api-response';
import { getTenantFromRequest } from '@/lib/tenant-context';
import { getDiscordMessage, editDiscordMessage } from '@/services/discord-local';
import {
  parsePrivateDmControlAction,
  privateDmMessageText,
  resolveDiscordEmbedMediaUrl,
  resolvePrivateDmTenantId,
  splitPrivateTtsText,
  toggleDiscordEmbedGif,
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
    return apiError('This Discord control link is invalid or expired.', {
      status: 401,
      code: 'INVALID_DISCORD_CONTROL',
    });
  }

  let tenantId = control.tenantId || '';
  if (control.scope === 'public') {
    const session = getTenantFromRequest(request);
    if (!session?.tenantId || session.tenantId !== tenantId) {
      return apiError('Sign in as the StreamWeaver owner to use controls on public embeds.', {
        status: 403,
        code: 'PUBLIC_CONTROL_OWNER_REQUIRED',
      });
    }
  } else {
    tenantId = await resolvePrivateDmTenantId(control.channelId) || '';
    if (!tenantId) {
      return apiError('The private Discord channel is no longer connected to a StreamWeaver account.', {
        status: 404,
        code: 'PRIVATE_CHANNEL_NOT_FOUND',
      });
    }
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
      const result = toggleDiscordEmbedGif(
        currentEmbeds,
        resolveDiscordEmbedMediaUrl(tenantId, control.scope),
      );
      await editDiscordMessage(control.channelId, control.messageId, { embeds: result.embeds });
      return apiOk({
        action,
        visible: result.visible,
        message: `${control.scope === 'public' ? 'Public' : 'Private'} GIF is now ${result.visible ? 'visible' : 'hidden'} on that Discord reply.`,
      });
    }

    const text = privateDmMessageText(message);
    const chunks = splitPrivateTtsText(text);
    if (!chunks.length) {
      return apiError('That Discord reply has no text to read.', {
        status: 400,
        code: 'NO_DISCORD_TTS_TEXT',
      });
    }

    const audioDataUris: string[] = [];
    for (const chunk of chunks) {
      const audioDataUri = await generateTTS(chunk, undefined, tenantId);
      if (audioDataUri) audioDataUris.push(audioDataUri);
    }
    if (!audioDataUris.length) {
      return apiError('Discord TTS returned no audio.', {
        status: 502,
        code: 'DISCORD_TTS_EMPTY',
      });
    }

    return apiOk({
      action,
      audioDataUris,
      chunkCount: audioDataUris.length,
      message: audioDataUris.length === 1
        ? 'TTS is ready.'
        : `TTS is ready in ${audioDataUris.length} parts.`,
    });
  } catch (error) {
    console.error('[Discord Embed Control] Action failed:', action, error);
    return apiError(safeError(error), {
      status: 500,
      code: 'DISCORD_CONTROL_FAILED',
    });
  }
}
