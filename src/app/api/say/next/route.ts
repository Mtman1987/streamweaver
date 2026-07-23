import { NextRequest, NextResponse } from 'next/server';
import { getSayQueue } from '../_store';
import { resolveSayQueueStreamKey } from '../_stream';
import { touchTtsConsumer } from '@/services/tts-consumer-presence';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const tenantId = await resolveSayQueueStreamKey(request.nextUrl.searchParams.get('tenantId'));
  // Polling this route is itself proof that a Say Player is actively
  // listening. This also keeps tabs opened before a deployment compatible
  // with the paid-synthesis presence guard.
  touchTtsConsumer(tenantId, 'say', 'say');
  const after = Math.max(0, Number(request.nextUrl.searchParams.get('after') || 0));
  const sayQueue = getSayQueue(tenantId);
  const latestId = sayQueue[sayQueue.length - 1]?.id || after;
  if (request.nextUrl.searchParams.get('latest') === '1') {
    return NextResponse.json({
      text: null,
      item: null,
      items: [],
      tenantId,
      latestId,
      remaining: 0,
    });
  }
  const items = sayQueue.filter((item) => item.id > after);
  const next = items[0] || null;
  return NextResponse.json({
    text: next?.audioUrl || null,
    item: next,
    items,
    tenantId,
    latestId,
    remaining: items.length,
  });
}
