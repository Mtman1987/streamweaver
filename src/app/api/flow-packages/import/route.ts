import { NextRequest } from 'next/server';
import { apiError, apiOk } from '@/lib/api-response';
import { getTenantFromRequest } from '@/lib/tenant-context';
import { flowPackageSelectionSchema, importFlowPackage, parseFlowPackage, selectFlowPackageEntries } from '@/lib/flow-packages';

export async function POST(request: NextRequest) {
  try {
    const session = getTenantFromRequest(request);
    const body = await request.json().catch(() => null);
    const rawPkg = body?.package ?? body;
    const pkg = parseFlowPackage(rawPkg);
    const selection = body?.selection ? flowPackageSelectionSchema.parse(body.selection) : undefined;
    const selectedPkg = selectFlowPackageEntries(pkg, selection);
    const imported = await importFlowPackage(selectedPkg, session?.tenantId);
    return apiOk({ ok: true, imported, packageId: selectedPkg.packageId });
  } catch (error: any) {
    return apiError(error?.message || 'Failed to import flow package.', { status: 400, code: 'INVALID_FLOW_PACKAGE' });
  }
}
