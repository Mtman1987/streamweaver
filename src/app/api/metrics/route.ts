import { NextRequest } from 'next/server';
import { getMetrics, loadMetrics } from '@/services/metrics';
import { getTenantFromRequest } from '@/lib/tenant-context';
import { apiOk } from '@/lib/api-response';

export async function GET(request: NextRequest) {
  const session = getTenantFromRequest(request);
  await loadMetrics(session?.tenantId);
  return apiOk(getMetrics());
}
