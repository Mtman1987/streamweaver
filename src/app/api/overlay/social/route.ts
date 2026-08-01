import { NextRequest } from 'next/server';
import { apiOk } from '@/lib/api-response';
import { getSocialOverlayEvents } from '@/services/social-overlay-events';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const tenantId = request.nextUrl.searchParams.get('tenant') || undefined;
  const after = request.nextUrl.searchParams.get('after') || undefined;
  const limit = Number(request.nextUrl.searchParams.get('limit') || 20);
  return apiOk({
    events: getSocialOverlayEvents({ tenantId, after, limit }),
    serverTime: new Date().toISOString(),
  });
}
