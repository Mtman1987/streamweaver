import { NextRequest } from 'next/server';
import { apiError, apiOk } from '@/lib/api-response';
import { getTenantFromRequest } from '@/lib/tenant-context';
import {
  getScheduledDiscordMessageCleanupIds,
  getPreservedDiscordMessageIds,
  preserveDiscordMessageFromCleanup,
  restoreDiscordMessageCleanup,
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
    preservedMessageIds: await getPreservedDiscordMessageIds(session.tenantId, channelId),
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
  const enabled = body?.enabled;
  if (!channelId || !messageId || typeof enabled !== 'boolean') {
    return apiError('A Discord channel ID and message ID are required.', { status: 400, code: 'MESSAGE_REQUIRED' });
  }

  const updated = enabled
    ? await restoreDiscordMessageCleanup(session.tenantId, channelId, messageId)
    : await preserveDiscordMessageFromCleanup(session.tenantId, channelId, messageId);
  if (!updated) {
    return apiError(
      enabled ? 'That message is not marked to be kept.' : 'That message is not in your pending cleanup queue.',
      { status: 404, code: 'MESSAGE_CLEANUP_STATE_NOT_FOUND' },
    );
  }

  return apiOk({ enabled, messageId });
}
