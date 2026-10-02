import { NextResponse } from 'next/server';
import { getLoungeBrowserRefresh } from '@/services/lounge-player-control';

export const dynamic = 'force-dynamic';

// Refresh once all matching overlay fixes are live, preserving the media prompt.
const PREVIOUS_REFRESH_AT = Date.parse('2026-10-02T13:35:00Z');
const FORCE_REFRESH_AT = Date.parse('2026-10-02T14:22:27Z');
let recoveryReady = false;
let recoveryCheckedAt = 0;

async function mediaPromptReady() {
  if (recoveryReady || Date.now() - recoveryCheckedAt < 10000) return recoveryReady;
  recoveryCheckedAt = Date.now();
  try {
    const response = await fetch('https://hearmeout-main.fly.dev/lounge-media/direct', {
      cache: 'no-store', signal: AbortSignal.timeout(3000),
    });
    if (response.ok && (await response.text()).includes('data-empty-request-prompt="v3"')) {
      const [lounge, chatTag] = await Promise.all([
        fetch('https://spmt.live/tenant/mtman1987/lounge', { cache: 'no-store', signal: AbortSignal.timeout(3000) }),
        fetch('https://chat-tag-new.fly.dev/overlay/preview?compact=lounge', { cache: 'no-store', signal: AbortSignal.timeout(3000) }),
      ]);
      recoveryReady = lounge.ok && chatTag.ok
        && (await lounge.text()).includes('spmt-commercial-ready')
        && (await chatTag.text()).includes('data-chat-tag-rotation="player-cards-v3"');
    }
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
