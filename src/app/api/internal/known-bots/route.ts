import { NextRequest } from 'next/server';
import { apiError, apiOk } from '@/lib/api-response';
import { hasInternalServiceAccess } from '@/lib/internal-service-auth';
import { addCustomBot, clearBotCache } from '@/services/known-bots';

export const dynamic = 'force-dynamic';

function normalizeUsername(value: unknown): string {
  return String(value || '').trim().toLowerCase().replace(/^[@#]+/, '');
}

export async function POST(request: NextRequest) {
  if (!hasInternalServiceAccess(request)) {
    return apiError('Unauthorized', { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const username = normalizeUsername(body?.username);
  const tenantId = String(body?.tenantId || '').trim();
  if (!username || !tenantId) {
    return apiError('username and tenantId are required', { status: 400 });
  }

  const added = await addCustomBot(username, tenantId);
  clearBotCache(tenantId);

  console.log(
    `[KnownBots] ${added ? 'Added' : 'Already present'} ${username} for tenant ${tenantId}`
      + ` source=${String(body?.source || 'internal')}`,
  );

  return apiOk({ username, tenantId, added, alreadyBlacklisted: !added });
}
