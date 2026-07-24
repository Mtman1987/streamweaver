import { NextRequest } from 'next/server';

import { apiError, apiOk } from '@/lib/api-response';
import { getTenantFromRequest } from '@/lib/tenant-context';
import { readSharedChatReplay } from '@/services/shared-chat-ingestion';

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
  const events = await readSharedChatReplay(session.tenantId, { limit });

  return apiOk({
    tenantId: session.tenantId,
    count: events.length,
    replayWindow: { limit },
    events,
  });
}
