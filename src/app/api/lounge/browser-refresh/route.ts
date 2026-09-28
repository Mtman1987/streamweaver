import { NextResponse } from 'next/server';
import { getLoungeBrowserRefresh } from '@/services/lounge-player-control';

export const dynamic = 'force-dynamic';

export async function GET() {
  const response = NextResponse.json(await getLoungeBrowserRefresh());
  response.headers.set('cache-control', 'no-store');
  response.headers.set('access-control-allow-origin', '*');
  return response;
}
