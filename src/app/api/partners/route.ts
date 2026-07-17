import { NextRequest } from 'next/server';
import { apiError, apiOk } from '@/lib/api-response';
import { getTenantFromRequest } from '@/lib/tenant-context';
import { getAllPartners } from '@/services/partner-checkin';
import { getCheckinStats, getPartnerOverrides, setPartnerOverrides } from '@/services/checkin-stats';

export async function GET(req: NextRequest) {
  const session = getTenantFromRequest(req);
  if (!session?.tenantId) return apiError('Authentication required', { status: 401, code: 'UNAUTHORIZED' });
  const tenantId = session.tenantId;
  const guildId = req.nextUrl.searchParams.get('guildId');
  const roleName = req.nextUrl.searchParams.get('roleName');

  if (!guildId || !roleName) {
    return apiError('guildId and roleName required', { status: 400, code: 'MISSING_PARAMS' });
  }

  const partners = await getAllPartners(guildId, roleName);
  const stats = getCheckinStats(tenantId);
  const overrides = getPartnerOverrides(tenantId);

  const enriched = partners.map(p => ({
    ...p,
    inviteLink: overrides[p.discordUserId]?.inviteLink || '',
    communityCheckins: stats.partnerCounts[p.name.toLowerCase()] || 0,
  }));

  return apiOk({ partners: enriched, stats });
}

export async function POST(req: NextRequest) {
  try {
    const session = getTenantFromRequest(req);
    if (!session?.tenantId) return apiError('Authentication required', { status: 401, code: 'UNAUTHORIZED' });
    const tenantId = session.tenantId;
    const body = await req.json();
    if (body.overrides && typeof body.overrides === 'object') {
      setPartnerOverrides(body.overrides, tenantId);
      return apiOk({ success: true });
    }
    return apiError('Invalid body', { status: 400, code: 'INVALID_BODY' });
  } catch {
    return apiError('Invalid JSON', { status: 400, code: 'INVALID_BODY' });
  }
}
