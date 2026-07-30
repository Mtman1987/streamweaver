import { z } from 'zod';

import { readSharedChatReplay } from '@/services/shared-chat-ingestion';
import {
  readSharedChatOperatorState,
  writeSharedChatOperatorState,
} from '@/services/shared-chat-operator-state';

export const SharedChatOperatorActionSchema = z.object({
  action: z.enum(['pin', 'unpin', 'queue', 'unqueue', 'feature', 'next', 'clear', 'set-auto-show', 'set-feature-options']),
  eventId: z.string().min(1).optional(),
  enabled: z.boolean().optional(),
  autoAdvance: z.boolean().optional(),
  durationSeconds: z.number().int().min(0).max(300).optional(),
  style: z.enum(['glass', 'solid', 'minimal']).optional(),
});

export type SharedChatOperatorAction = z.infer<typeof SharedChatOperatorActionSchema>;

export async function applySharedChatOperatorAction(tenantId: string, input: SharedChatOperatorAction) {
  const current = await readSharedChatOperatorState(tenantId);
  const replay = await readSharedChatReplay(tenantId, { limit: 500 });
  const knownIds = new Set(replay.map((event) => event.eventId));
  const { action, eventId } = input;
  if (eventId && !knownIds.has(eventId)) {
    throw Object.assign(new Error('The selected chat event is no longer in the replay window'), {
      statusCode: 404,
      code: 'EVENT_NOT_FOUND',
    });
  }

  let pinnedEventIds = current.pinnedEventIds.filter((id) => knownIds.has(id));
  let queuedEventIds = current.queuedEventIds.filter((id) => knownIds.has(id));
  let featuredEventId = current.featuredEventId && knownIds.has(current.featuredEventId)
    ? current.featuredEventId
    : null;
  let autoShow = current.autoShow;
  let autoAdvance = current.autoAdvance;
  let featureDurationSeconds = current.featureDurationSeconds;
  let featureStyle = current.featureStyle;
  let featuredAt = current.featuredAt;

  if (action === 'pin' && eventId) pinnedEventIds = Array.from(new Set([...pinnedEventIds, eventId]));
  if (action === 'unpin' && eventId) pinnedEventIds = pinnedEventIds.filter((id) => id !== eventId);
  if (action === 'queue' && eventId) {
    queuedEventIds = Array.from(new Set([...queuedEventIds, eventId]));
    if (autoShow && !featuredEventId) {
      featuredEventId = eventId;
      featuredAt = new Date().toISOString();
      queuedEventIds = queuedEventIds.filter((id) => id !== eventId);
    }
  }
  if (action === 'unqueue' && eventId) queuedEventIds = queuedEventIds.filter((id) => id !== eventId);
  if (action === 'feature') {
    featuredEventId = eventId || null;
    featuredAt = featuredEventId ? new Date().toISOString() : null;
  }
  if (action === 'next') {
    featuredEventId = queuedEventIds[0] || null;
    featuredAt = featuredEventId ? new Date().toISOString() : null;
    queuedEventIds = queuedEventIds.slice(1);
  }
  if (action === 'clear') {
    featuredEventId = null;
    featuredAt = null;
  }
  if (action === 'set-auto-show') autoShow = input.enabled === true;
  if (action === 'set-feature-options') {
    if (input.autoAdvance !== undefined) autoAdvance = input.autoAdvance;
    if (input.durationSeconds !== undefined) featureDurationSeconds = input.durationSeconds;
    if (input.style !== undefined) featureStyle = input.style;
  }

  return writeSharedChatOperatorState(tenantId, {
    pinnedEventIds,
    queuedEventIds,
    featuredEventId,
    autoShow,
    autoAdvance,
    featureDurationSeconds,
    featureStyle,
    featuredAt,
  });
}
