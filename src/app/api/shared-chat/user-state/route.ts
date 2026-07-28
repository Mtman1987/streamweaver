import { NextRequest } from 'next/server';
import { z } from 'zod';

import { apiError, apiOk } from '@/lib/api-response';
import { getTenantFromRequest } from '@/lib/tenant-context';
import { readSharedChatReplay } from '@/services/shared-chat-ingestion';
import {
  readSharedChatUserState,
  writeSharedChatUserState,
} from '@/services/shared-chat-user-state';

const SavedFilterSchema = z.object({
  id: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1).max(80),
  platform: z.string().trim().max(40).default('all'),
  query: z.string().trim().max(200).default(''),
});

const UpdateSchema = z.object({
  lastReadEventId: z.string().min(1).nullable().optional(),
  savedFilters: z.array(SavedFilterSchema).max(20).optional(),
});

export async function GET(request: NextRequest) {
  const session = getTenantFromRequest(request);
  if (!session?.tenantId) return apiError('Authentication required', { status: 401, code: 'UNAUTHORIZED' });
  return apiOk({
    tenantId: session.tenantId,
    username: session.username,
    state: await readSharedChatUserState(session.tenantId, session.username),
  });
}

export async function PUT(request: NextRequest) {
  const session = getTenantFromRequest(request);
  if (!session?.tenantId) return apiError('Authentication required', { status: 401, code: 'UNAUTHORIZED' });
  const parsed = UpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError('Invalid shared-chat user state', { status: 400, code: 'INVALID_BODY' });

  const current = await readSharedChatUserState(session.tenantId, session.username);
  if (parsed.data.lastReadEventId) {
    const replay = await readSharedChatReplay(session.tenantId, { limit: 500 });
    if (!replay.some((event) => event.eventId === parsed.data.lastReadEventId)) {
      return apiError('Read cursor is outside the replay window', { status: 404, code: 'EVENT_NOT_FOUND' });
    }
  }
  const state = await writeSharedChatUserState(session.tenantId, session.username, {
    lastReadEventId: parsed.data.lastReadEventId === undefined
      ? current.lastReadEventId
      : parsed.data.lastReadEventId,
    savedFilters: parsed.data.savedFilters ?? current.savedFilters,
  });
  return apiOk({ tenantId: session.tenantId, username: session.username, state });
}
