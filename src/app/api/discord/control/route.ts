import { NextRequest } from 'next/server';
import { apiError, apiOk } from '@/lib/api-response';
import { getTenantFromRequest } from '@/lib/tenant-context';
import { getSpmtDiscordIdentity } from '@/lib/spmt-userinfo';
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
import { hasActiveTtsConsumer } from '@/services/tts-consumer-presence';
import { addSayQueueItem, getSayQueue } from '@/app/api/say/_store';
import { togglePublicBotTtsEnabled } from '@/services/public-bot-tts';

export const dynamic = 'force-dynamic';

type PublicControlBody = { token?: unknown; action?: unknown; voice?: unknown };

function safeError(error: unknown): string {
  return String(error instanceof Error ? error.message : error || 'Control action failed')
    .replace(/https?:\/\/\S+/gi, '[endpoint]')
    .replace(/bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
}

async function editControlledMessage(channelId: string, messageId: string, embeds: Record<string, unknown>[]): Promise<void> {
  try {
    await editDiscordMessage(channelId, messageId, { embeds });
    return;
  } catch {
    // Tenant-branded public replies are commonly webhook messages.
  }
  if (!await editWebhookMessage(channelId, messageId, { embeds })) {
    throw new Error('Discord would not allow this public reply to be edited.');
  }
}

function requireOwningTenant(request: NextRequest, tenantId: string) {
  const session = getTenantFromRequest(request);
  return session?.tenantId === tenantId ? session : null;
}

async function canDeletePublicReply(request: NextRequest, tenantId: string): Promise<boolean> {
  if (requireOwningTenant(request, tenantId)) return true;
  const spmtIdentity = await getSpmtDiscordIdentity(request).catch(() => null);
  return spmtIdentity?.isAdmin === true;
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as PublicControlBody | null;
  const token = String(body?.token || '').trim();
  const action = parseDiscordMessageControlAction(body?.action);
  const control = verifyDiscordMessageControlToken(token);

  if (!control || control.scope !== 'public' || !action || action === 'adult') {
    return apiError('This public Discord control link is invalid or expired.', { status: 401, code: 'INVALID_PUBLIC_CONTROL' });
  }

  if (action === 'delete') {
    if (!await canDeletePublicReply(request, control.tenantId)) {
      return apiError('Only the bot owner or an approved SpaceMountain administrator can delete this public reply.', { status: 403, code: 'PUBLIC_DELETE_FORBIDDEN' });
    }
  } else if (!requireOwningTenant(request, control.tenantId)) {
    return apiError('Sign in to the StreamWeaver account that owns this bot to use its public reply controls.', { status: 401, code: 'TENANT_AUTH_REQUIRED' });
  }

  try {
    if (action === 'settings') return apiOk({ action, redirectUrl: '/bot-functions' });

    if (action === 'delete') {
      await deleteMessage(control.channelId, control.messageId);
      return apiOk({ action, deleted: true, message: 'Public bot reply deleted from Discord. No private memory was touched.' });
    }

    const message = await getDiscordMessage(control.channelId, control.messageId) as any;
    const currentEmbeds = Array.isArray(message?.embeds) ? message.embeds : [];

    if (action === 'gif') {
      const mediaUrl = resolvePublicDiscordMediaUrl(control.tenantId);
      if (!mediaUrl) return apiOk({ action, visible: false, message: 'This bot does not have a public Discord GIF configured.' });
      const toggled = toggleConfiguredDiscordGif(currentEmbeds, mediaUrl);
      const embeds = attachPublicDiscordControls(toggled.embeds, {
        channelId: control.channelId,
        messageId: control.messageId,
        tenantId: control.tenantId,
        gifVisible: toggled.visible,
      });
      await editControlledMessage(control.channelId, control.messageId, embeds);
      return apiOk({ action, visible: toggled.visible, message: `Public bot GIF is now ${toggled.visible ? 'visible' : 'hidden'}.` });
    }

    // The public speaker button is a persistent bot toggle. Audio is queued on
    // the same Say Player/browser-source stream as human chat TTS; HearMeOut is
    // not opened or joined by this path.
    const enabled = await togglePublicBotTtsEnabled(control.channelId, control.tenantId);
    const streamKey = `discord:${control.channelId}`;
    if (!enabled) {
      return apiOk({
        action,
        enabled: false,
        delivered: 'say-player',
        streamKey,
        queued: 0,
        message: 'Bot TTS is OFF. Future replies from this bot stay silent until you click the speaker again.',
      });
    }

    if (!hasActiveTtsConsumer(streamKey, 'say')) {
      return apiOk({
        action,
        enabled: true,
        delivered: 'say-player',
        streamKey,
        queued: 0,
        skipped: true,
        reason: 'no-active-say-listener',
        message: 'Bot TTS is ON. Open or activate the public TTS browser source to hear this and future replies.',
      });
    }

    const text = discordMessageText(message);
    if (!text) return apiOk({ action, enabled: true, streamKey, queued: 0, message: 'Bot TTS is ON. This reply had no text to read.' });

    let queued = 0;
    for (const chunk of splitDiscordTtsText(text)) {
      const audioDataUri = await generateTTS(chunk, undefined, streamKey, { requireActiveConsumer: true, consumerScope: 'say' });
      if (!audioDataUri) continue;
      addSayQueueItem(streamKey, audioDataUri);
      queued += 1;
    }

    return apiOk({
      action,
      enabled: true,
      delivered: 'say-player',
      streamKey,
      queued,
      queueLength: getSayQueue(streamKey).length,
      message: queued
        ? 'Bot TTS is ON. This reply was added to the shared public TTS browser source; future replies will speak automatically.'
        : 'Bot TTS is ON, but TTS returned no audio for this reply.',
    });
  } catch (error) {
    console.error('[Public Discord Control] Action failed:', action, error);
    return apiError(safeError(error), { status: 500, code: 'PUBLIC_CONTROL_FAILED' });
  }
}
