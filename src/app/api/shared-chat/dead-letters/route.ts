import { NextRequest } from 'next/server';

import { apiError, apiOk } from '@/lib/api-response';
import { getTenantFromRequest } from '@/lib/tenant-context';
import { readSharedChatDeadLetters, type SharedChatDeadLetter } from '@/services/shared-chat-ingestion';

function parseLimit(value: string | null, fallback: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(max, Math.floor(parsed)));
}

function payloadPreview(payload: unknown): string {
  try {
    const serialized = JSON.stringify(payload);
    if (!serialized) return '';
    return serialized.length > 300 ? `${serialized.slice(0, 300)}...` : serialized;
  } catch {
    return '[unserializable payload]';
  }
}

function serializeDeadLetter(entry: SharedChatDeadLetter, includePayload: boolean) {
  if (includePayload) return entry;
  const { payload: _payload, ...safeEntry } = entry;
  return {
    ...safeEntry,
    payloadPreview: payloadPreview(entry.payload),
  };
}

export async function GET(request: NextRequest) {
  const session = getTenantFromRequest(request);
  if (!session?.tenantId) {
    return apiError('Authentication required', { status: 401, code: 'UNAUTHORIZED' });
  }

  const limit = parseLimit(request.nextUrl.searchParams.get('limit'), 50, 200);
  const includePayload = request.nextUrl.searchParams.get('includePayload') === 'true';
  const deadLetters = await readSharedChatDeadLetters(session.tenantId, { limit });

  return apiOk({
    tenantId: session.tenantId,
    count: deadLetters.length,
    deadLetterWindow: { limit },
    deadLetters: deadLetters.map((entry) => serializeDeadLetter(entry, includePayload)),
  });
}
