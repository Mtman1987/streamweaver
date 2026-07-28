import { NextRequest } from 'next/server';
import { z } from 'zod';

import { apiError, apiOk } from '@/lib/api-response';
import { getTenantFromRequest } from '@/lib/tenant-context';
import { readSharedChatReplay } from '@/services/shared-chat-ingestion';

const ReplySchema = z.object({
  eventId: z.string().min(1),
  message: z.string().trim().min(1).max(500),
  as: z.enum(['bot', 'broadcaster']).default('broadcaster'),
});

export async function POST(request: NextRequest) {
  const session = getTenantFromRequest(request);
  if (!session?.tenantId) return apiError('Authentication required', { status: 401, code: 'UNAUTHORIZED' });
  const parsed = ReplySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError('Invalid reply request', { status: 400, code: 'INVALID_BODY' });

  const replay = await readSharedChatReplay(session.tenantId, { limit: 500 });
  const event = replay.find((entry) => entry.eventId === parsed.data.eventId);
  if (!event) return apiError('Chat event is outside the replay window', { status: 404, code: 'EVENT_NOT_FOUND' });
  if (!event.routing.canReply || event.platform !== 'twitch' || !event.routing.replyTarget?.startsWith('twitch:')) {
    return apiError('This source does not have a verified outbound reply adapter', { status: 409, code: 'REPLY_UNSUPPORTED' });
  }

  const targetChannel = event.routing.replyTarget.slice('twitch:'.length).toLowerCase();
  const eventChannel = String(event.channelName || event.sourceName || '').replace(/^#/, '').toLowerCase();
  if (!targetChannel || targetChannel !== eventChannel) {
    return apiError('Reply destination failed source validation', { status: 409, code: 'REPLY_TARGET_MISMATCH' });
  }

  const wsPort = process.env.WS_PORT || '8090';
  const response = await fetch(`http://127.0.0.1:${wsPort}/api/twitch/send-message`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      tenantId: session.tenantId,
      as: parsed.data.as,
      message: `@${event.sender.login || event.sender.displayName} ${parsed.data.message}`,
    }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    return apiError(result.error || 'Twitch reply failed', { status: response.status, code: 'REPLY_FAILED' });
  }
  return apiOk({
    sent: true,
    adapter: 'twitch',
    eventId: event.eventId,
    replyTarget: event.routing.replyTarget,
  });
}
