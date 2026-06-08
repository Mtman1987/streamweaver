import { NextRequest } from 'next/server';
import { z } from 'zod';
import { apiError, apiOk } from '@/lib/api-response';
import { getTenantFromRequest } from '@/lib/tenant-context';
import { deletePublishedFlowPackage, getTenantFlowPackage, listPublishedFlowPackages, parseFlowPackage, publishFlowPackage, publishTenantFlowPackage } from '@/lib/flow-packages';
import { isAdmin } from '@/lib/tenant';

const publishSchema = z.object({
  packageId: z.string().min(1).optional(),
  package: z.unknown().optional(),
}).passthrough();

export async function GET() {
  try {
    const packages = await listPublishedFlowPackages();
    return apiOk({ packages });
  } catch (error: any) {
    return apiError(error?.message || 'Failed to load community flow packages.', { status: 500, code: 'INTERNAL_ERROR' });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = getTenantFromRequest(request);
    const parsed = publishSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return apiError('Invalid publish request', { status: 400, code: 'INVALID_BODY' });
    }

    if (parsed.data.package) {
      const pkg = parseFlowPackage(parsed.data.package);
      const saved = await publishFlowPackage(pkg);
      return apiOk({ package: saved });
    }

    if (!parsed.data.packageId) {
      return apiError('packageId is required', { status: 400, code: 'INVALID_BODY' });
    }

    const preview = await getTenantFlowPackage(parsed.data.packageId, session?.tenantId);
    if (!preview) {
      return apiError('Flow package not found', { status: 404, code: 'NOT_FOUND' });
    }

    const saved = await publishTenantFlowPackage(parsed.data.packageId, session?.tenantId);
    return apiOk({ package: saved });
  } catch (error: any) {
    return apiError(error?.message || 'Failed to publish flow package.', { status: 500, code: 'INTERNAL_ERROR' });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const session = getTenantFromRequest(request);
    if (!session) {
      return apiError('Not authenticated', { status: 401, code: 'UNAUTHENTICATED' });
    }
    if (!isAdmin(session.tenantId)) {
      return apiError('Admin only', { status: 403, code: 'FORBIDDEN' });
    }

    const packageId = request.nextUrl.searchParams.get('packageId');
    if (!packageId) {
      return apiError('packageId is required', { status: 400, code: 'INVALID_BODY' });
    }

    const deleted = await deletePublishedFlowPackage(packageId);
    if (!deleted) {
      return apiError('Published flow package not found', { status: 404, code: 'NOT_FOUND' });
    }

    return apiOk({ ok: true, packageId });
  } catch (error: any) {
    return apiError(error?.message || 'Failed to unpublish flow package.', { status: 500, code: 'INTERNAL_ERROR' });
  }
}
