import { NextResponse } from 'next/server';
import { getCommercialBreakState, withSpotlightCommercialBreak } from '@/services/commercial-break';
import { SPACEMOUNTAIN_SYSTEM_TENANT_ID } from '@/lib/tenant';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const LOUNGE_WORKER_URL = String(process.env.HMO_LOUNGE_WORKER_URL || 'https://hmo-dj-worker.fly.dev:4444').replace(/\/+$/, '');
const SPOTLIGHT_WORKER_URL = String(process.env.HMO_SPOTLIGHT_WORKER_URL || 'https://hmo-dj-worker.fly.dev:4445').replace(/\/+$/, '');
let spotlightProgram: unknown = null;
let spotlightCheckedAt = 0;
let spotlightRequest: Promise<unknown> | null = null;

async function currentSpotlightProgram(): Promise<unknown> {
  if (spotlightRequest) return spotlightRequest;
  if (Date.now() - spotlightCheckedAt < 2000) return spotlightProgram;
  spotlightRequest = (async () => {
    try {
      const response = await fetch(`${SPOTLIGHT_WORKER_URL}/spotlight/program`, {
        cache: 'no-store', headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(2000),
      });
      if (response.ok) spotlightProgram = await response.json();
    } catch { /* A confirmed marker still expires at its original activeUntil. */ }
    finally { spotlightCheckedAt = Date.now(); spotlightRequest = null; }
    return spotlightProgram;
  })();
  return spotlightRequest;
}

async function mediaActive(): Promise<boolean> {
  try {
    const response = await fetch(`${LOUNGE_WORKER_URL}/lounge/media/program`, {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      signal: typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(2_000) : undefined,
    });
    if (!response.ok) return true;
    const program = await response.json();
    return Boolean(
      (program?.movie?.current && program?.movie?.playback?.status === 'playing')
      || (program?.music?.current && program?.music?.playback?.status === 'playing')
    );
  } catch {
    // Fail silent rather than risk commercial music over an unknown HMO state.
    return true;
  }
}

export async function GET(request?: Request) {
  const rawDelay = request ? new URL(request.url).searchParams.get('playbackDelayMs') : null;
  const delay = rawDelay === null ? 60000 : Number(rawDelay);
  const [state, hasMedia, spotlight] = await Promise.all([
    getCommercialBreakState(SPACEMOUNTAIN_SYSTEM_TENANT_ID),
    mediaActive(),
    currentSpotlightProgram(),
  ]);
  return NextResponse.json({ ...withSpotlightCommercialBreak(state, spotlight, Date.now(), delay), mediaActive: hasMedia }, {
    headers: { 'cache-control': 'no-store, no-cache, must-revalidate', 'access-control-allow-origin': '*' },
  });
}
