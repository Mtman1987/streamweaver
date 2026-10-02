import { NextResponse } from 'next/server';
import { getLoungeBrowserRefresh } from '@/services/lounge-player-control';

export const dynamic = 'force-dynamic';

// Refresh the failed game iframe after its bounded recovery script is live.
const PREVIOUS_REFRESH_AT = Date.parse('2026-10-02T11:21:22Z');
const FORCE_REFRESH_AT = Date.parse('2026-10-02T12:14:38Z');
let recoveryReady = false;
let recoveryCheckedAt = 0;

async function gameRecoveryReady() {
  if (recoveryReady || Date.now() - recoveryCheckedAt < 10000) return recoveryReady;
  recoveryCheckedAt = Date.now();
  try {
    const response = await fetch('https://chat-tag-new.fly.dev/overlay-chunk-recovery.js', {
      cache: 'no-store', signal: AbortSignal.timeout(3000),
    });
    if (response.ok && (await response.text()).includes('nebula:chunk-recovery:')) recoveryReady = true;
  } catch {}
  return recoveryReady;
}

export async function GET() {
  const [state, ready] = await Promise.all([getLoungeBrowserRefresh(), gameRecoveryReady()]);
  const response = NextResponse.json({
    ...state,
    requestedAt: Math.max(Number(state.requestedAt) || 0, ready ? FORCE_REFRESH_AT : PREVIOUS_REFRESH_AT),
  });
  response.headers.set('cache-control', 'no-store');
  response.headers.set('access-control-allow-origin', '*');
  return response;
}
