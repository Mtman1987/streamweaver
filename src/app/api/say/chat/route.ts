import { createHash } from 'node:crypto';
import { runSayChatRequest } from '@/services/say-chat-request';
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { apiError, apiOk } from '@/lib/api-response';
import { getTenantFromRequest } from '@/lib/tenant-context';
import { resolveSayQueueStreamKey } from '../_stream';
import { resolveSayChatIdentity } from '@/services/say-chat';
import { sendWebhookMessage } from '@/services/discord-webhooks';

const sayChatSchema = z.object({
  text: z.string().trim().min(1, 'Message required').max(500, 'Message too long'),
  captureId: z.string().uuid().optional(),
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
  if (!authenticated) return apiError('Unauthorized', { status: 401, code: 'UNAUTHORIZED' });
  return apiOk({ identity: authenticated.identity });
}

export async function POST(request: NextRequest) {
  const authenticated = authenticatedIdentity(request);
  if (!authenticated) return apiError('Unauthorized', { status: 401, code: 'UNAUTHORIZED' });

  const parsed = sayChatSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError('Invalid speech-to-chat request', { status: 400, code: 'INVALID_BODY' });

  const { session, identity } = authenticated;
  const { text, voice, captureId } = parsed.data;
  const streamKey = await resolveSayQueueStreamKey(parsed.data.streamKey || session.tenantId);

  const deliver = async () => {
    try {
      if (streamKey.startsWith('discord:')) {
        const channelId = streamKey.slice('discord:'.length);
        if (!/^\d{16,20}$/.test(channelId)) return apiError('Invalid Discord room', { status: 400, code: 'INVALID_DISCORD_ROOM' });
        await sendWebhookMessage(channelId, text, identity.username, identity.avatarUrl);
      } else {
        // The Lounge's canonical TTS stream omits the twitch: prefix. Keep its
        // chat destination instead of falling back to the signed-in user's room.
        const targetChannel = streamKey === 'spacemountainlive'
          ? streamKey
          : streamKey.startsWith('twitch:') ? streamKey.slice('twitch:'.length) : undefined;
        const wsPort = process.env.WS_PORT || '8090';
        const response = await fetch(`http://127.0.0.1:${wsPort}/api/twitch/send-message`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: text, as: 'broadcaster', tenantId: targetChannel ? undefined : session.tenantId, targetChannel, forceSayTts: true }),
        });
        const result = await response.json().catch(() => null);
        if (!response.ok || result?.success !== true || result?.skipped === true) {
          throw new Error(result?.error || (result?.skipped === true
            ? 'Twitch chat post was skipped; your speech was not posted.'
            : 'Twitch chat post failed'));
        }
      }
    } catch (error) {
      console.error('[Say Chat] Chat post failed:', error);
      return apiError(error instanceof Error ? error.message : 'Chat post failed', { status: 502, code: 'CHAT_POST_FAILED' });
    }

    return apiOk({
      posted: true,
      queued: false,
      delivered: 'chat-echo',
      tenantId: streamKey,
      identity,
    });
  };
  if (!captureId) return deliver();
  const key = JSON.stringify([session.tenantId, streamKey, captureId]);
  const fingerprint = createHash('sha256').update(JSON.stringify([text, voice || ''])).digest('hex');
  return runSayChatRequest(key, fingerprint, deliver);
}
