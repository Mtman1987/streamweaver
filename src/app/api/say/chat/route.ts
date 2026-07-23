import { NextRequest } from 'next/server';
import { z } from 'zod';
import { apiError, apiOk } from '@/lib/api-response';
import { getTenantFromRequest } from '@/lib/tenant-context';
import { addSayQueueItem, getSayQueue } from '../_store';
import { resolveSayQueueStreamKey } from '../_stream';
import { buildSayChatSpeech, resolveSayChatIdentity } from '@/services/say-chat';
import { sendWebhookMessage } from '@/services/discord-webhooks';
import { generateTTS } from '@/services/tts-provider';
import { touchTtsConsumer } from '@/services/tts-consumer-presence';

const sayChatSchema = z.object({
  text: z.string().trim().min(1, 'Message required').max(500, 'Message too long'),
  streamKey: z.string().trim().max(128).optional(),
  voice: z.string().trim().max(128).optional(),
});

function authenticatedIdentity(request: NextRequest) {
  const session = getTenantFromRequest(request);
  if (!session?.tenantId) return null;
  return { session, identity: resolveSayChatIdentity(session) };
}

export async function GET(request: NextRequest) {
  const authenticated = authenticatedIdentity(request);
  if (!authenticated) {
    return apiError('Unauthorized', { status: 401, code: 'UNAUTHORIZED' });
  }

  return apiOk({ identity: authenticated.identity });
}

export async function POST(request: NextRequest) {
  const authenticated = authenticatedIdentity(request);
  if (!authenticated) {
    return apiError('Unauthorized', { status: 401, code: 'UNAUTHORIZED' });
  }

  const parsed = sayChatSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return apiError('Invalid speech-to-chat request', { status: 400, code: 'INVALID_BODY' });
  }

  const { session, identity } = authenticated;
  const { text, voice } = parsed.data;
  const streamKey = await resolveSayQueueStreamKey(parsed.data.streamKey || session.tenantId);

  try {
    if (streamKey.startsWith('discord:')) {
      const channelId = streamKey.slice('discord:'.length);
      if (!/^\d{16,20}$/.test(channelId)) {
        return apiError('Invalid Discord room', { status: 400, code: 'INVALID_DISCORD_ROOM' });
      }
      await sendWebhookMessage(channelId, text, identity.username, identity.avatarUrl);
    } else {
      const targetChannel = streamKey.startsWith('twitch:')
        ? streamKey.slice('twitch:'.length)
        : undefined;
      const wsPort = process.env.WS_PORT || '8090';
      const response = await fetch(`http://127.0.0.1:${wsPort}/api/twitch/send-message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          as: 'broadcaster',
          tenantId: session.tenantId,
          targetChannel,
        }),
      });
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result?.error || 'Twitch chat post failed');
      }
    }
  } catch (error) {
    console.error('[Say Chat] Chat post failed:', error);
    return apiError(error instanceof Error ? error.message : 'Chat post failed', {
      status: 502,
      code: 'CHAT_POST_FAILED',
    });
  }

  try {
    const spokenText = buildSayChatSpeech(identity, text);
    const voiceOverride = voice || undefined;
    // This request originates from the active Say Player itself, so it is
    // authoritative proof of a live playback consumer even if the tab was
    // opened before a deploy and missed the new heartbeat code.
    touchTtsConsumer(streamKey, 'say', 'say');
    const audioDataUri = await generateTTS(
      spokenText,
      voiceOverride,
      streamKey,
      { requireActiveConsumer: true, consumerScope: 'say' },
    );
    if (!audioDataUri) {
      return apiOk({
        posted: true,
        queued: false,
        skipped: true,
        reason: 'no-active-say-listener',
        tenantId: streamKey,
        identity,
      });
    }
    const item = addSayQueueItem(streamKey, audioDataUri);
    return apiOk({
      posted: true,
      queued: true,
      tenantId: streamKey,
      queueLength: getSayQueue(streamKey).length,
      id: item.id,
      identity,
      spokenText,
    });
  } catch (error) {
    console.error('[Say Chat] TTS queue failed after chat post:', error);
    return apiError('Posted in chat, but TTS could not read it', {
      status: 502,
      code: 'TTS_QUEUE_FAILED',
      details: { posted: true, queued: false, identity },
    });
  }
}
