import type { NextRequest } from 'next/server';
import { getTenantFromRequest } from '@/lib/tenant-context';
import { hasMountainViewBridgeAccess } from '@/lib/internal-service-auth';

/**
 * Resolve the tenant for a request that may come from a browser session or from
 * the MountainView bridge. Browser sessions carry the tenant in a cookie; bridge
 * requests carry it in the body/query. The bridge-supplied value is only trusted
 * when the request actually passes MountainView bridge auth.
 */
export function resolveTenantId(
  request: NextRequest,
  bridgeSupplied?: string | null,
): string {
  const session = getTenantFromRequest(request);
  if (session?.tenantId) return session.tenantId;
  if (hasMountainViewBridgeAccess(request)) {
    return String(bridgeSupplied || '').trim();
  }
  return '';
}
