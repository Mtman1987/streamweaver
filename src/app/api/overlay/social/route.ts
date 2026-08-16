import { NextRequest } from 'next/server';
import { apiOk } from '@/lib/api-response';
import { getSocialOverlayEvents } from '@/services/social-overlay-events';
import { resolveOverlayTenantId } from '@/lib/overlay-tenant.server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const tenantId = await resolveOverlayTenantId(request.nextUrl.searchParams.get('tenant'));
  const after = request.nextUrl.searchParams.get('after') || undefined;
  const limit = Number(request.nextUrl.searchParams.get('limit') || 20);
  return apiOk({
    events: getSocialOverlayEvents({ tenantId, after, limit }),
    serverTime: new Date().toISOString(),
  });
}
