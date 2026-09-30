import { NextResponse } from 'next/server';
import { getCommercialBreakState } from '@/services/commercial-break';
import { SPACEMOUNTAIN_SYSTEM_TENANT_ID } from '@/lib/tenant';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const LOUNGE_WORKER_URL = String(process.env.HMO_LOUNGE_WORKER_URL || 'https://hmo-dj-worker.fly.dev:4444').replace(/\/+$/, '');

async function mediaActive(): Promise<boolean> {
  try {
    const response = await fetch(`${LOUNGE_WORKER_URL}/lounge/media/program`, {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      signal: typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(8_000) : undefined,
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

export async function GET() {
  const [state, hasMedia] = await Promise.all([
    getCommercialBreakState(SPACEMOUNTAIN_SYSTEM_TENANT_ID),
    mediaActive(),
  ]);
  return NextResponse.json({ ...state, mediaActive: hasMedia }, {
    headers: { 'cache-control': 'no-store, no-cache, must-revalidate' },
  });
}
