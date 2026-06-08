import { NextRequest } from 'next/server';
import { apiError, apiOk } from '@/lib/api-response';
import { getTenantFromRequest } from '@/lib/tenant-context';
import { deleteTenantFlowPackage, listTenantFlowPackages } from '@/lib/flow-packages';

export async function GET(request: NextRequest) {
  try {
    const session = getTenantFromRequest(request);
    const packages = await listTenantFlowPackages(session?.tenantId);
    return apiOk({ packages });
  } catch (error: any) {
    return apiError(error?.message || 'Failed to load flow packages.', { status: 500, code: 'INTERNAL_ERROR' });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const session = getTenantFromRequest(request);
    const packageId = request.nextUrl.searchParams.get('packageId');
    if (!packageId) {
      return apiError('packageId is required', { status: 400, code: 'INVALID_BODY' });
    }

    const deleted = await deleteTenantFlowPackage(packageId, session?.tenantId);
    return apiOk({ ok: true, packageId, deleted });
  } catch (error: any) {
    const status = error?.message === 'Flow package not found' ? 404 : 500;
    return apiError(error?.message || 'Failed to delete flow package.', { status, code: status === 404 ? 'NOT_FOUND' : 'INTERNAL_ERROR' });
  }
}
