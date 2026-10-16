import { NextResponse } from 'next/server';
import { getLoungeMediaLayout } from '@/services/lounge-media-layout';

export const dynamic = 'force-dynamic';

/**
 * This endpoint is polled by the live Lounge viewer. It must be read-only:
 * changing layout state as a side effect of GET can immediately undo a bump
 * when the media worker reports a temporarily empty/incorrect program.
 */
export async function GET() {
  const layout = await getLoungeMediaLayout();
  const response = NextResponse.json(layout);
  response.headers.set('cache-control', 'no-store');
  response.headers.set('access-control-allow-origin', '*');
  return response;
}
