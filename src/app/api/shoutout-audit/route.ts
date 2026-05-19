import { NextRequest } from 'next/server';
import { apiError, apiOk } from '@/lib/api-response';
import { getTenantFromRequest } from '@/lib/tenant-context';
import { readRecentShoutoutAudit, readRecentShoutoutAuditForAllTenants } from '@/services/shoutout-audit';

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const limit = Number(url.searchParams.get('limit') || 200);
    const session = getTenantFromRequest(request);
    if (!session) {
      return apiError('Login required', { status: 401, code: 'UNAUTHORIZED' });
    }
    const requestedTenantId = url.searchParams.get('tenantId')?.trim() || 'all';
    const readAll = requestedTenantId === 'all';
    const tenantId = readAll ? 'all' : requestedTenantId || session.tenantId;
    const events = readAll
      ? await readRecentShoutoutAuditForAllTenants(limit)
      : await readRecentShoutoutAudit(tenantId, limit);

    return apiOk({
      tenantId: tenantId || 'global',
      count: events.length,
      events,
    });
  } catch (error) {
    console.error('[shoutout-audit] Error:', error);
    return apiError(error instanceof Error ? error.message : 'Failed to read shoutout audit', {
      status: 500,
      code: 'INTERNAL_ERROR',
    });
  }
}
