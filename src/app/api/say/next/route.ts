import { NextRequest, NextResponse } from 'next/server';
import { getSayQueue, normalizeSayQueueTenant } from '../_store';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const tenantId = normalizeSayQueueTenant(request.nextUrl.searchParams.get('tenantId'));
  const sayQueue = getSayQueue(tenantId);
  const text = sayQueue.shift();
  return NextResponse.json({ text: text || null, tenantId });
}
