import { NextRequest } from 'next/server';
import { z } from 'zod';

import { apiError, apiOk } from '@/lib/api-response';
import { sendDiscordMessage, deleteMessage as deleteDiscordMessage } from '@/services/discord';
import { getKickService } from '@/services/kick';
import { readSharedChatReplay } from '@/services/shared-chat-ingestion';
import { timeoutUser as timeoutTwitchUser } from '@/services/twitch';

const DestinationSchema = z.object({
  platform: z.enum(['twitch', 'discord', 'kick', 'youtube']),
  channelId: z.string().trim().min(1).max(160),
  channelName: z.string().trim().min(1).max(160),
});

const DispatchSchema = z.object({
  idempotencyKey: z.string().trim().min(8).max(200),
  action: z.enum(['compose', 'reply', 'timeout', 'delete']).default('compose'),
  destination: DestinationSchema,
  message: z.string().trim().max(2_000).optional().default(''),
  eventId: z.string().trim().max(240).optional(),
  durationSeconds: z.number().int().min(1).max(1_209_600).optional(),
});

function canonicalPlatform(event: { platform: string; meta?: Record<string, unknown> }) {
  return event.platform === 'social-stream'
    ? String(event.meta?.rawProvider || '').trim().toLowerCase()
    : event.platform;
}

function canonicalDestinationChannelId(platform: string, value: string) {
  const raw = String(value || '').trim();
  return platform === 'discord' ? raw.replace(/^discord:/i, '') : raw;
}

function destinationMatchesEvent(
  event: { platform: string; channelId: string; channelName?: string; sourceName?: string; meta?: Record<string, unknown> },
  destination: z.infer<typeof DestinationSchema>,
) {
  if (canonicalPlatform(event) !== destination.platform) return false;
  const eventChannelId = canonicalDestinationChannelId(destination.platform, event.channelId);
  const destinationChannelId = canonicalDestinationChannelId(destination.platform, destination.channelId);
  if (!eventChannelId || eventChannelId !== destinationChannelId) return false;

  // Discord channel ids are globally unique. Older replay records sometimes had
  // a generic/missing channel name, so the verified channel id is authoritative.
  if (destination.platform === 'discord') return true;

  return String(event.channelName || event.sourceName || '').replace(/^#/, '').toLowerCase()
    === destination.channelName.replace(/^#/, '').toLowerCase();
}

export async function POST(request: NextRequest) {
  const expectedKey = String(process.env.SPMT_SYSTEM_KEY || '').trim();
  const providedKey = String(request.headers.get('x-spmt-key') || '').trim();
  const tenantId = String(request.headers.get('x-spmt-tenant-id') || '').trim();
  if (!expectedKey || providedKey !== expectedKey) {
    return apiError('SPMT service authentication required', { status: 401, code: 'UNAUTHORIZED' });
  }
  if (!tenantId) return apiError('SPMT tenant required', { status: 400, code: 'TENANT_REQUIRED' });

  const parsed = DispatchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError('Invalid dispatch request', { status: 400, code: 'INVALID_BODY' });
  const input = parsed.data;
  if (['compose', 'reply'].includes(input.action) && !input.message) {
    return apiError('Message required', { status: 400, code: 'MESSAGE_REQUIRED' });
  }
  if (input.action !== 'compose' && !input.eventId) {
    return apiError('A source event is required for this action', { status: 400, code: 'EVENT_REQUIRED' });
  }

  const replay = await readSharedChatReplay(tenantId, { limit: 500 });
  const matchingEvents = replay.filter((event) => destinationMatchesEvent(event, input.destination));
  if (!matchingEvents.length) {
    return apiError('Destination is not present in this tenant replay window', {
      status: 409,
      code: 'DESTINATION_NOT_VERIFIED',
    });
  }

  const sourceEvent = input.eventId
    ? matchingEvents.find((event) => event.eventId === input.eventId)
    : undefined;
  if (input.eventId && !sourceEvent) {
    return apiError('Action target failed source validation', { status: 409, code: 'SOURCE_TARGET_MISMATCH' });
  }

  try {
    if (input.action === 'compose') {
      if (input.destination.platform === 'twitch') {
        const wsPort = process.env.WS_PORT || '8090';
        const response = await fetch(`http://127.0.0.1:${wsPort}/api/twitch/send-message`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            tenantId,
            as: 'broadcaster',
            targetChannel: input.destination.channelName.replace(/^#/, ''),
            message: input.message,
          }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || `Twitch send failed (${response.status})`);
      } else if (input.destination.platform === 'discord') {
        await sendDiscordMessage(
          canonicalDestinationChannelId('discord', input.destination.channelId),
          input.message,
        );
      } else if (input.destination.platform === 'kick') {
        await getKickService(tenantId).sendChatMessage(input.message);
      } else {
        return apiError('YouTube egress is not tenant-isolated yet', {
          status: 409,
          code: 'ADAPTER_UNAVAILABLE',
        });
      }
    } else if (input.action === 'reply') {
      if (!sourceEvent?.routing.canReply || input.destination.platform !== 'twitch') {
        return apiError('This source does not expose a verified reply adapter', {
          status: 409,
          code: 'REPLY_UNSUPPORTED',
        });
      }
      const expectedTarget = `twitch:${input.destination.channelName.replace(/^#/, '').toLowerCase()}`;
      if (sourceEvent.routing.replyTarget !== expectedTarget) {
        return apiError('Reply target failed source validation', { status: 409, code: 'REPLY_TARGET_MISMATCH' });
      }
      const wsPort = process.env.WS_PORT || '8090';
      const response = await fetch(`http://127.0.0.1:${wsPort}/api/twitch/send-message`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tenantId,
          as: 'broadcaster',
          targetChannel: input.destination.channelName.replace(/^#/, ''),
          message: `@${sourceEvent.sender.login || sourceEvent.sender.displayName} ${input.message}`,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || `Twitch reply failed (${response.status})`);
    } else if (input.action === 'timeout') {
      if (input.destination.platform !== 'twitch' || !sourceEvent) {
        return apiError('Timeout is not available for this source', { status: 409, code: 'MODERATION_UNSUPPORTED' });
      }
      const username = String(sourceEvent.sender.login || sourceEvent.sender.displayName || '').trim();
      const ok = await timeoutTwitchUser(username, input.durationSeconds || 600, 'Commlink moderation', tenantId);
      if (!ok) throw new Error('Twitch rejected the timeout request');
    } else if (input.action === 'delete') {
      if (input.destination.platform !== 'discord' || !sourceEvent) {
        return apiError('Delete is not available for this source', { status: 409, code: 'MODERATION_UNSUPPORTED' });
      }
      await deleteDiscordMessage(
        canonicalDestinationChannelId('discord', input.destination.channelId),
        sourceEvent.upstreamId,
      );
    }

    return apiOk({
      version: 'outbound-message-receipt.v1',
      idempotencyKey: input.idempotencyKey,
      status: 'delivered',
      action: input.action,
      destination: input.destination,
      sourceEventId: input.eventId || null,
      deliveredAt: new Date().toISOString(),
    });
  } catch (error) {
    return apiError(error instanceof Error ? error.message : 'Provider dispatch failed', {
      status: 502,
      code: 'PROVIDER_DISPATCH_FAILED',
    });
  }
}
