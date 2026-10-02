import { NextResponse } from 'next/server';
import { getLoungeMediaPlayerRestart } from '@/services/lounge-player-control';

export async function GET() {
  const response = NextResponse.json(await getLoungeMediaPlayerRestart());
  response.headers.set('cache-control', 'no-store');
  return response;
}
