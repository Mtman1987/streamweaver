import { NextResponse } from 'next/server';
import { getLoungeBrowserRefresh } from '@/services/lounge-player-control';

export const dynamic = 'force-dynamic';

// Refresh existing lounge viewers once the new empty-media prompt is live.
const PREVIOUS_REFRESH_AT = Date.parse('2026-10-02T12:31:03Z');
const FORCE_REFRESH_AT = Date.parse('2026-10-02T12:44:44Z');
let recoveryReady = false;
let recoveryCheckedAt = 0;

async function mediaPromptReady() {
  if (recoveryReady || Date.now() - recoveryCheckedAt < 10000) return recoveryReady;
  recoveryCheckedAt = Date.now();
  try {
    const response = await fetch('https://hearmeout-main.fly.dev/lounge-media/direct', {
      cache: 'no-store', signal: AbortSignal.timeout(3000),
    });
    if (response.ok && (await response.text()).includes('data-empty-request-prompt="v2"')) recoveryReady = true;
  } catch {}
  return recoveryReady;
}

export async function GET() {
  const [state, ready] = await Promise.all([getLoungeBrowserRefresh(), mediaPromptReady()]);
  const response = NextResponse.json({
    ...state,
    requestedAt: Math.max(Number(state.requestedAt) || 0, ready ? FORCE_REFRESH_AT : PREVIOUS_REFRESH_AT),
  });
  response.headers.set('cache-control', 'no-store');
  response.headers.set('access-control-allow-origin', '*');
  return response;
}
