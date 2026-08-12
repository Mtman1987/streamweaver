import { NextRequest } from 'next/server';
import { apiError, apiOk } from '@/lib/api-response';
import { getTenantFromRequest } from '@/lib/tenant-context';
import { deleteMessage, editDiscordMessage, getDiscordMessage } from '@/services/discord-local';
import { editWebhookMessage } from '@/services/discord-webhooks';
import {
  attachPublicDiscordControls,
  discordMessageText,
  parseDiscordMessageControlAction,
  resolvePublicDiscordMediaUrl,
  splitDiscordTtsText,
  toggleConfiguredDiscordGif,
  verifyDiscordMessageControlToken,
} from '@/services/private-dm-controls';
import { generateTTS } from '@/services/tts-provider';

export const dynamic = 'force-dynamic';

type PublicControlBody = {
  token?: unknown;
  action?: unknown;
  voice?: unknown;
};

function safeError(error: unknown): string {
  return String(error instanceof Error ? error.message : error || 'Control action failed')
    .replace(/https?:\/\/\S+/gi, '[endpoint]')
    .replace(/bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
}

function voiceOverride(value: unknown): string | undefined {
  const normalized = String(value || '').trim();
  return normalized ? normalized.slice(0, 128) : undefined;
}

async function editControlledMessage(
  channelId: string,
  messageId: string,
  embeds: Record<string, unknown>[],
): Promise<void> {
  try {
    await editDiscordMessage(channelId, messageId, { embeds });
    return;
  } catch {
    // Public tenant-branded replies are commonly webhook messages. Fall back to
    // the channel webhook so the control strip does not force generic bot branding.
  }
  if (!await editWebhookMessage(channelId, messageId, { embeds })) {
    throw new Error('Discord would not allow this public reply to be edited.');
  }
}

async function generatePublicAudio(text: string, tenantId: string, voice?: string): Promise<string[]> {
  const audioDataUris: string[] = [];
  for (const chunk of splitDiscordTtsText(text)) {
    const audioDataUri = await generateTTS(chunk, voice, tenantId);
    if (audioDataUri) audioDataUris.push(audioDataUri);
  }
  return audioDataUris;
}

function requireOwningTenant(request: NextRequest, tenantId: string) {
  const session = getTenantFromRequest(request);
  return session?.tenantId === tenantId ? session : null;
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as PublicControlBody | null;
  const token = String(body?.token || '').trim();
  const action = parseDiscordMessageControlAction(body?.action);
  const control = verifyDiscordMessageControlToken(token);

  if (!control || control.scope !== 'public' || !action || action === 'adult') {
    return apiError('This public Discord control link is invalid or expired.', {
      status: 401,
      code: 'INVALID_PUBLIC_CONTROL',
    });
  }

  // The strip is intentionally visible on public bot replies, but actions are
  // owner controls. Without this gate any viewer could mutate the shared GIF,
  // delete a reply, or repeatedly trigger paid TTS synthesis from a public link.
  if (!requireOwningTenant(request, control.tenantId)) {
    return apiError('Sign in to the StreamWeaver account that owns this bot to use its public reply controls.', {
      status: 401,
      code: 'TENANT_AUTH_REQUIRED',
    });
  }

  try {
    if (action === 'settings') {
      return apiOk({ action, redirectUrl: '/bot-functions' });
    }

    if (action === 'delete') {
      await deleteMessage(control.channelId, control.messageId);
      return apiOk({
        action,
        deleted: true,
        message: 'Public bot reply deleted from Discord. No private memory was touched.',
      });
    }

    const message = await getDiscordMessage(control.channelId, control.messageId) as any;
    const currentEmbeds = Array.isArray(message?.embeds) ? message.embeds : [];

    if (action === 'gif') {
      const mediaUrl = resolvePublicDiscordMediaUrl(control.tenantId);
      if (!mediaUrl) {
        return apiOk({
          action,
          visible: false,
          message: 'This bot does not have a public Discord GIF configured.',
        });
      }
      const toggled = toggleConfiguredDiscordGif(currentEmbeds, mediaUrl);
      const embeds = attachPublicDiscordControls(toggled.embeds, {
        channelId: control.channelId,
        messageId: control.messageId,
        tenantId: control.tenantId,
        gifVisible: toggled.visible,
      });
      await editControlledMessage(control.channelId, control.messageId, embeds);
      return apiOk({
        action,
        visible: toggled.visible,
        message: `Public bot GIF is now ${toggled.visible ? 'visible' : 'hidden'}.`,
      });
    }

    const text = discordMessageText(message);
    if (!text) {
      return apiError('This public reply has no text to read aloud.', {
        status: 400,
        code: 'NO_TTS_TEXT',
      });
    }
    const audioDataUris = await generatePublicAudio(text, control.tenantId, voiceOverride(body?.voice));
    return apiOk({
      action,
      audioDataUris,
      chunkCount: audioDataUris.length,
      message: audioDataUris.length ? 'Public bot reply audio is ready.' : 'TTS returned no audio.',
    });
  } catch (error) {
    console.error('[Public Discord Control] Action failed:', action, error);
    return apiError(safeError(error), {
      status: 500,
      code: 'PUBLIC_CONTROL_FAILED',
    });
  }
}
