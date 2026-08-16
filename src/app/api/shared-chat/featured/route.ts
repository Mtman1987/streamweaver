import { NextRequest, NextResponse } from 'next/server';

import { readSharedChatReplay } from '@/services/shared-chat-ingestion';
import {
  readSharedChatOperatorState,
  writeSharedChatOperatorState,
} from '@/services/shared-chat-operator-state';
import { resolveOverlayTenantId } from '@/lib/overlay-tenant.server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: NextRequest) {
  const requestedTenant = String(request.nextUrl.searchParams.get('tenant') || '').trim();
  if (!requestedTenant) return NextResponse.json({ error: 'tenant query parameter is required' }, { status: 400 });
  const tenantId = await resolveOverlayTenantId(requestedTenant);
  if (!tenantId) return NextResponse.json({ error: 'tenant query parameter is required' }, { status: 400 });

  const replay = await readSharedChatReplay(tenantId, { limit: 500 });
  const knownIds = new Set(replay.map((event) => event.eventId));
  let state = await readSharedChatOperatorState(tenantId);
  const featuredExpired = Boolean(
    state.featuredEventId
    && state.featuredAt
    && state.featureDurationSeconds > 0
    && Date.now() - new Date(state.featuredAt).getTime() >= state.featureDurationSeconds * 1000,
  );
  if (featuredExpired) {
    const queuedEventIds = state.queuedEventIds.filter((id) => knownIds.has(id));
    const nextId = state.autoAdvance ? queuedEventIds[0] || null : null;
    state = await writeSharedChatOperatorState(tenantId, {
      ...state,
      queuedEventIds: nextId ? queuedEventIds.slice(1) : queuedEventIds,
      featuredEventId: nextId,
      featuredAt: nextId ? new Date().toISOString() : null,
    });
  }
  const event = state.featuredEventId
    ? replay.find((entry) => entry.eventId === state.featuredEventId) || null
    : null;
  return NextResponse.json({
    event,
    presentation: {
      style: state.featureStyle,
      durationSeconds: state.featureDurationSeconds,
      autoAdvance: state.autoAdvance,
      featuredAt: state.featuredAt,
    },
  }, {
    headers: { 'cache-control': 'no-store, no-cache, must-revalidate' },
  });
}
