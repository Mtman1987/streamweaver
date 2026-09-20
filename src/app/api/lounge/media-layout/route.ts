import { NextResponse } from 'next/server';
import { getLoungeMediaLayout } from '@/services/lounge-media-layout';

export const dynamic = 'force-dynamic';

export async function GET() {
  const response = NextResponse.json(await getLoungeMediaLayout());
  response.headers.set('cache-control', 'no-store');
  response.headers.set('access-control-allow-origin', '*');
  return response;
}
