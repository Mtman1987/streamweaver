import { NextRequest } from 'next/server';
import { apiError, apiOk } from '@/lib/api-response';
import { getTenantFromRequest } from '@/lib/tenant-context';
import {
  isDiscordMessageCleanupEnabled,
  setDiscordMessageCleanupEnabled,
} from '@/services/discord-message-cleanup';

export async function GET(request: NextRequest) {
  const session = getTenantFromRequest(request);
  if (!session?.tenantId) {
    return apiError('Sign in to manage Discord message cleanup.', { status: 401, code: 'UNAUTHORIZED' });
  }

  return apiOk({ enabled: await isDiscordMessageCleanupEnabled(session.tenantId) });
}

export async function POST(request: NextRequest) {
  const session = getTenantFromRequest(request);
  if (!session?.tenantId) {
    return apiError('Sign in to manage Discord message cleanup.', { status: 401, code: 'UNAUTHORIZED' });
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body.enabled !== 'boolean') {
    return apiError('Expected an enabled boolean.', { status: 400, code: 'INVALID_BODY' });
  }

  try {
    await setDiscordMessageCleanupEnabled(session.tenantId, body.enabled);
    return apiOk({ enabled: await isDiscordMessageCleanupEnabled(session.tenantId) });
  } catch (error) {
    return apiError(error instanceof Error ? error.message : String(error), {
      status: 500,
      code: 'CLEANUP_SETTING_SAVE_FAILED',
    });
  }
}
