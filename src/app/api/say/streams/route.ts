import { NextResponse } from 'next/server';
import { listSayQueueStreams } from '../_store';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({ streams: listSayQueueStreams() });
}
