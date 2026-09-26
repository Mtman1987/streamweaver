import { NextRequest, NextResponse } from 'next/server';

import { readSharedChatReplay } from '@/services/shared-chat-ingestion';
import {
  readSharedChatOperatorState,
  writeSharedChatOperatorState,
} from '@/services/shared-chat-operator-state';
import { resolveOverlayTenantId } from '@/lib/overlay-tenant.server';
import { isKnownBot } from '@/services/known-bots';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const FALLBACK_MAX_AGE_MS = 45_000;

function normalizedSenderNames(entry: Awaited<ReturnType<typeof readSharedChatReplay>>[number]): string[] {
  return [entry.sender.login, entry.sender.displayName]
    .map((value) => String(value || '').trim().replace(/^@/, '').toLowerCase())
    .filter(Boolean);
}

async function isLoungeShowcaseEligible(
  entry: Awaited<ReturnType<typeof readSharedChatReplay>>[number],
  tenantId: string,
): Promise<boolean> {
  if (entry.type === 'system' || entry.deletedAt || !(entry.text.trim() || entry.media.length)) return false;

  const message = entry.text.trim().toLowerCase();
  if (message.startsWith('!') || message.startsWith('spmt')) return false;

  const senderNames = normalizedSenderNames(entry);
  // Never let a synthetic/internal user_<id> placeholder appear as a person.
  // Those entries have not proved a public identity and are not showcase-safe.
  if (senderNames.some((name) => /^user_[a-z0-9_-]+$/i.test(name))) return false;
  if (entry.sender.roles.includes('bot')) return false;

  for (const senderName of senderNames) {
    if (await isKnownBot(senderName, tenantId)) return false;
  }
  return true;
}

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
  const explicitCandidate = state.featuredEventId
    ? replay.find((entry) => entry.eventId === state.featuredEventId) || null
    : null;
  const explicitlyFeaturedEvent = explicitCandidate && await isLoungeShowcaseEligible(explicitCandidate, tenantId)
    ? explicitCandidate
    : null;
  const fallbackToLatest = request.nextUrl.searchParams.get('fallback') === 'latest';
  let latestShowcaseEvent = null;
  if (fallbackToLatest) {
    for (const entry of replay.slice().reverse()) {
      const seenAt = Date.parse(entry.originalTimestamp || entry.receivedTimestamp || '');
      if (!Number.isFinite(seenAt) || Date.now() - seenAt > FALLBACK_MAX_AGE_MS) continue;
      if (await isLoungeShowcaseEligible(entry, tenantId)) {
        latestShowcaseEvent = entry;
        break;
      }
    }
  }
  const event = explicitlyFeaturedEvent || latestShowcaseEvent;
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
