import { NextRequest, NextResponse } from 'next/server';
import { getBicData, getVictimList } from '@/services/bic-storage';
import { getOverlayData } from '@/services/overlay-manager';
import { resolveOverlayTenantId } from '@/lib/overlay-tenant.server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: NextRequest) {
  const tenantId = await resolveOverlayTenantId(request.nextUrl.searchParams.get('tenant'));
  const data = getBicData();
  const victims = getVictimList();
  const overlay = await getOverlayData('bic-counter', tenantId);
  const top = victims[0];
  return NextResponse.json(
    {
      total: data.total,
      lastUser: overlay?.lastUser || top?.name || '',
      lastUserCount: overlay?.lastUserCount || top?.count || 0,
      victimCount: victims.length,
    },
    {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      },
    }
  );
}
