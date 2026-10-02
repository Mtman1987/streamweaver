import { NextResponse } from 'next/server';
import { getLoungeBrowserRefresh } from '@/services/lounge-player-control';

export const dynamic = 'force-dynamic';

// Load the playback-aware commercial renderer once after this release.
const FORCE_REFRESH_AT = Date.parse('2026-10-02T11:21:22Z');

export async function GET() {
  const state = await getLoungeBrowserRefresh();
  const response = NextResponse.json({
    ...state,
    requestedAt: Math.max(Number(state.requestedAt) || 0, FORCE_REFRESH_AT),
  });
  response.headers.set('cache-control', 'no-store');
  response.headers.set('access-control-allow-origin', '*');
  return response;
}
