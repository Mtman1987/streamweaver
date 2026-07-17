import { NextRequest } from 'next/server';
import { getMetrics, loadMetrics } from '@/services/metrics';
import { getTenantFromRequest } from '@/lib/tenant-context';
import { apiError, apiOk } from '@/lib/api-response';

export async function GET(request: NextRequest) {
  const session = getTenantFromRequest(request);
  if (!session?.tenantId) return apiError('Authentication required', { status: 401, code: 'UNAUTHORIZED' });
  await loadMetrics(session.tenantId);
  return apiOk(getMetrics(session.tenantId));
}
