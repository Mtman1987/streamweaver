import { NextResponse } from 'next/server';
import { getBicData, getVictimList } from '@/services/bic-storage';
import { getOverlayData } from '@/services/overlay-manager';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  const data = getBicData();
  const victims = getVictimList();
  const overlay = await getOverlayData('bic-counter');
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
