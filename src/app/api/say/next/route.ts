import { NextRequest, NextResponse } from 'next/server';
import { getSayQueue, normalizeSayQueueTenant } from '../_store';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const tenantId = normalizeSayQueueTenant(request.nextUrl.searchParams.get('tenantId'));
  const after = Math.max(0, Number(request.nextUrl.searchParams.get('after') || 0));
  const sayQueue = getSayQueue(tenantId);
  const items = sayQueue.filter((item) => item.id > after);
  const next = items[0] || null;
  return NextResponse.json({
    text: next?.audioUrl || null,
    item: next,
    items,
    tenantId,
    latestId: sayQueue[sayQueue.length - 1]?.id || after,
    remaining: items.length,
  });
}
