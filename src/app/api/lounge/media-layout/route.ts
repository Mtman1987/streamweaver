import { NextResponse } from 'next/server';
import { getLoungeMediaLayout, setLoungeMediaLayout } from '@/services/lounge-media-layout';

export const dynamic = 'force-dynamic';

export async function GET() {
  let layout = await getLoungeMediaLayout();
  if (layout.mode === 'media') {
    try {
      const worker = String(process.env.HMO_LOUNGE_WORKER_URL || 'https://hmo-dj-worker.fly.dev:4444').replace(/\/+$/, '');
      const mediaResponse = await fetch(`${worker}/lounge/media/program`, { cache: 'no-store' });
      if (mediaResponse.ok) {
        const program = await mediaResponse.json();
        const mediaPresent = Boolean(program?.movie?.current || program?.music?.current);
        const mediaQueued = Number(program?.movie?.queueCount || 0) > 0 || Number(program?.music?.queueCount || 0) > 0;
        if (!mediaPresent && !mediaQueued) {
          layout = await setLoungeMediaLayout('stream', 'auto:empty-media');
        }
      }
    } catch {
      // Keep the current layout if the media worker is temporarily unavailable.
    }
  }
  const response = NextResponse.json(layout);
  response.headers.set('cache-control', 'no-store');
  response.headers.set('access-control-allow-origin', '*');
  return response;
}
