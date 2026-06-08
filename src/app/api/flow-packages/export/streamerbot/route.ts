import { NextRequest } from 'next/server';
import { apiError, apiOk } from '@/lib/api-response';
import { getTenantFromRequest } from '@/lib/tenant-context';
import { getTenantFlowPackage, parseFlowPackage } from '@/lib/flow-packages';
import { exportFlowPackageToStreamerbot } from '@/lib/streamerbot-export';

export async function POST(request: NextRequest) {
  try {
    const session = getTenantFromRequest(request);
    const body = await request.json().catch(() => null);

    let pkg = body?.package ? parseFlowPackage(body.package) : null;
    if (!pkg && body?.packageId) {
      pkg = await getTenantFlowPackage(String(body.packageId), session?.tenantId);
    }

    if (!pkg) {
      return apiError('package or packageId is required', { status: 400, code: 'INVALID_BODY' });
    }

    return apiOk(exportFlowPackageToStreamerbot(pkg));
  } catch (error: any) {
    return apiError(error?.message || 'Failed to export Streamer.bot package.', { status: 400, code: 'INVALID_STREAMERBOT_EXPORT' });
  }
}
