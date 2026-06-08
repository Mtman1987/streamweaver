import { NextRequest } from 'next/server';
import { apiError, apiOk } from '@/lib/api-response';
import {
  buildFlowPackageManifestDraft,
  flowPackageManifestSchema,
  getFlowPackageManifest,
  getTenantFlowPackage,
  listPublishedFlowPackages,
  saveFlowPackageManifest,
} from '@/lib/flow-packages';
import { getTenantFromRequest } from '@/lib/tenant-context';

export async function GET(request: NextRequest) {
  try {
    const session = getTenantFromRequest(request);
    const url = new URL(request.url);
    const packageId = url.searchParams.get('packageId');
    const source = url.searchParams.get('source') || 'tenant';
    if (!packageId) {
      return apiError('packageId is required', { status: 400, code: 'INVALID_QUERY' });
    }

    const existing = await getFlowPackageManifest(packageId);
    if (existing) return apiOk({ manifest: existing });

    if (source === 'published') {
      const packages = await listPublishedFlowPackages();
      const pkg = packages.find((item) => item.packageId === packageId);
      if (!pkg) return apiError('Flow package not found', { status: 404, code: 'NOT_FOUND' });
      return apiOk({ manifest: buildFlowPackageManifestDraft(pkg) });
    }

    const pkg = await getTenantFlowPackage(packageId, session?.tenantId);
    if (!pkg) return apiError('Flow package not found', { status: 404, code: 'NOT_FOUND' });
    return apiOk({ manifest: buildFlowPackageManifestDraft(pkg) });
  } catch (error: any) {
    return apiError(error?.message || 'Failed to load flow package manifest.', { status: 500, code: 'INTERNAL_ERROR' });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    const manifest = flowPackageManifestSchema.parse(body?.manifest ?? body);
    const saved = await saveFlowPackageManifest(manifest);
    return apiOk({ manifest: saved });
  } catch (error: any) {
    return apiError(error?.message || 'Failed to save flow package manifest.', { status: 400, code: 'INVALID_MANIFEST' });
  }
}
