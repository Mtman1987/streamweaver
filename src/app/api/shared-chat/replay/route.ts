import { NextRequest } from 'next/server';

import { apiError, apiOk } from '@/lib/api-response';
import { getTenantFromRequest } from '@/lib/tenant-context';
import { readSharedChatReplay } from '@/services/shared-chat-ingestion';
import { SharedChatEventTypeSchema, SharedChatPlatformSchema } from '@/contracts/shared-chat-event';

function parseLimit(value: string | null, fallback: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(max, Math.floor(parsed)));
}

export async function GET(request: NextRequest) {
  const session = getTenantFromRequest(request);
  if (!session?.tenantId) {
    return apiError('Authentication required', { status: 401, code: 'UNAUTHORIZED' });
  }

  const limit = parseLimit(request.nextUrl.searchParams.get('limit'), 100, 500);
  const replay = await readSharedChatReplay(session.tenantId, { limit: 500 });
  const after = String(request.nextUrl.searchParams.get('after') || '').trim();
  const platformValue = String(request.nextUrl.searchParams.get('platform') || '').trim();
  const typeValue = String(request.nextUrl.searchParams.get('type') || '').trim();
  const source = String(request.nextUrl.searchParams.get('source') || '').trim().toLowerCase();
  const channel = String(request.nextUrl.searchParams.get('channel') || '').trim().toLowerCase();
  const query = String(request.nextUrl.searchParams.get('q') || '').trim().toLowerCase();
  const role = String(request.nextUrl.searchParams.get('role') || '').trim().toLowerCase();
  const donationOnly = request.nextUrl.searchParams.get('donation') === 'true';
  const membershipOnly = request.nextUrl.searchParams.get('membership') === 'true';
  const platform = SharedChatPlatformSchema.safeParse(platformValue);
  const eventType = SharedChatEventTypeSchema.safeParse(typeValue);
  const afterIndex = after ? replay.findIndex((event) => event.eventId === after) : -1;
  const unseen = after && afterIndex >= 0 ? replay.slice(afterIndex + 1) : replay;
  const filtered = unseen.filter((event) => {
    if (platformValue && (!platform.success || event.platform !== platform.data)) return false;
    if (typeValue && (!eventType.success || event.type !== eventType.data)) return false;
    if (source && !`${event.sourceId} ${event.sourceName || ''}`.toLowerCase().includes(source)) return false;
    if (channel && !`${event.channelId} ${event.channelName || ''}`.toLowerCase().includes(channel)) return false;
    if (query && !`${event.sender.displayName} ${event.sender.login || ''} ${event.text}`.toLowerCase().includes(query)) return false;
    if (role && !event.sender.roles.some((entry) => entry === role)) return false;
    if (donationOnly && !event.donation) return false;
    if (membershipOnly && !event.membership) return false;
    return true;
  });
  const events = (after ? filtered.slice(0, limit) : filtered.slice(-limit));
  const nextCursor = replay.at(-1)?.eventId || after || null;

  return apiOk({
    tenantId: session.tenantId,
    count: events.length,
    replayWindow: {
      limit,
      capacity: 500,
      after: after || null,
      nextCursor,
      cursorFound: !after || afterIndex >= 0,
      hasMore: filtered.length > events.length,
    },
    filters: {
      platform: platform.success ? platform.data : null,
      type: eventType.success ? eventType.data : null,
      source: source || null,
      channel: channel || null,
      query: query || null,
      role: role || null,
      donation: donationOnly,
      membership: membershipOnly,
    },
    events,
  });
}
