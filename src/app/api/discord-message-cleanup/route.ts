import { NextRequest } from 'next/server';
import { apiError, apiOk } from '@/lib/api-response';
import { getTenantFromRequest } from '@/lib/tenant-context';
import {
  getScheduledDiscordMessageCleanupIds,
  preserveDiscordMessageFromCleanup,
} from '@/services/discord-message-cleanup';

export async function GET(request: NextRequest) {
  const session = getTenantFromRequest(request);
  if (!session?.tenantId) {
    return apiError('Sign in to manage Discord message cleanup.', { status: 401, code: 'UNAUTHORIZED' });
  }

  const channelId = String(request.nextUrl.searchParams.get('channelId') || '').trim();
  if (!channelId) return apiError('A Discord channel ID is required.', { status: 400, code: 'CHANNEL_REQUIRED' });

  return apiOk({
    scheduledMessageIds: await getScheduledDiscordMessageCleanupIds(session.tenantId, channelId),
  });
}

export async function POST(request: NextRequest) {
  const session = getTenantFromRequest(request);
  if (!session?.tenantId) {
    return apiError('Sign in to manage Discord message cleanup.', { status: 401, code: 'UNAUTHORIZED' });
  }

  const body = await request.json().catch(() => null);
  const channelId = String(body?.channelId || '').trim();
  const messageId = String(body?.messageId || '').trim();
  if (!channelId || !messageId) {
    return apiError('A Discord channel ID and message ID are required.', { status: 400, code: 'MESSAGE_REQUIRED' });
  }

  const preserved = await preserveDiscordMessageFromCleanup(session.tenantId, channelId, messageId);
  if (!preserved) {
    return apiError('That message is not in your pending cleanup queue.', { status: 404, code: 'MESSAGE_NOT_QUEUED' });
  }

  return apiOk({ preserved: true, messageId });
}
