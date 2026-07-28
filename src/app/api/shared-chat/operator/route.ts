import { NextRequest } from 'next/server';
import { z } from 'zod';

import { apiError, apiOk } from '@/lib/api-response';
import { getTenantFromRequest } from '@/lib/tenant-context';
import { readSharedChatReplay } from '@/services/shared-chat-ingestion';
import {
  readSharedChatOperatorState,
  writeSharedChatOperatorState,
} from '@/services/shared-chat-operator-state';

const ActionSchema = z.object({
  action: z.enum(['pin', 'unpin', 'queue', 'unqueue', 'feature', 'next', 'clear', 'set-auto-show', 'set-feature-options']),
  eventId: z.string().min(1).optional(),
  enabled: z.boolean().optional(),
  autoAdvance: z.boolean().optional(),
  durationSeconds: z.number().int().min(0).max(300).optional(),
  style: z.enum(['glass', 'solid', 'minimal']).optional(),
});

export async function GET(request: NextRequest) {
  const session = getTenantFromRequest(request);
  if (!session?.tenantId) {
    return apiError('Authentication required', { status: 401, code: 'UNAUTHORIZED' });
  }
  return apiOk({
    tenantId: session.tenantId,
    state: await readSharedChatOperatorState(session.tenantId),
  });
}

export async function POST(request: NextRequest) {
  const session = getTenantFromRequest(request);
  if (!session?.tenantId) {
    return apiError('Authentication required', { status: 401, code: 'UNAUTHORIZED' });
  }
  const parsed = ActionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return apiError('Invalid shared-chat operator action', { status: 400, code: 'INVALID_ACTION' });
  }

  const current = await readSharedChatOperatorState(session.tenantId);
  const replay = await readSharedChatReplay(session.tenantId, { limit: 500 });
  const knownIds = new Set(replay.map((event) => event.eventId));
  const { action, eventId } = parsed.data;
  if (eventId && !knownIds.has(eventId)) {
    return apiError('The selected chat event is no longer in the replay window', { status: 404, code: 'EVENT_NOT_FOUND' });
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
  if (action === 'set-auto-show') autoShow = parsed.data.enabled === true;
  if (action === 'set-feature-options') {
    if (parsed.data.autoAdvance !== undefined) autoAdvance = parsed.data.autoAdvance;
    if (parsed.data.durationSeconds !== undefined) featureDurationSeconds = parsed.data.durationSeconds;
    if (parsed.data.style !== undefined) featureStyle = parsed.data.style;
  }

  const state = await writeSharedChatOperatorState(session.tenantId, {
    pinnedEventIds,
    queuedEventIds,
    featuredEventId,
    autoShow,
    autoAdvance,
    featureDurationSeconds,
    featureStyle,
    featuredAt,
  });
  return apiOk({ tenantId: session.tenantId, state });
}
