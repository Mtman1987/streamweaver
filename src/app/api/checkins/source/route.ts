import { NextRequest } from 'next/server';
import { apiError, apiOk } from '@/lib/api-response';
import { getTenantFromRequest } from '@/lib/tenant-context';
import { getCheckinSource, type CheckinKind } from '@/services/checkin-sources';
import { getCheckinStats } from '@/services/checkin-stats';

const VALID_KINDS: CheckinKind[] = ['partner', 'crew', 'mod', 'space-mountain'];

export async function GET(req: NextRequest) {
  const kind = req.nextUrl.searchParams.get('kind') as CheckinKind | null;
  if (!kind || !VALID_KINDS.includes(kind)) {
    return apiError('Invalid kind', { status: 400, code: 'INVALID_KIND' });
  }

  const session = getTenantFromRequest(req);
  if (!session?.tenantId) {
    return apiError('Authentication required', { status: 401, code: 'UNAUTHORIZED' });
  }
  const tenantId = session.tenantId;
  const actor = req.nextUrl.searchParams.get('actor') || undefined;

  const source = await getCheckinSource(kind, tenantId, actor);
  const stats = getCheckinStats(tenantId);

  return apiOk({ source, stats });
}
