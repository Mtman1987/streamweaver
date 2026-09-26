import { NextRequest, NextResponse } from 'next/server';
import { getBRBMediaPlaylist } from '@/services/brb-clips';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  // Public overlay playback only; the tenant and Twitch source are fixed to
  // the one community Lounge and this endpoint cannot start a chat command.
  if (request.nextUrl.searchParams.get('tenant') !== 'spacemountainlive') {
    return NextResponse.json({ error: 'Unknown Lounge' }, { status: 404 });
  }
  try {
    const media = await getBRBMediaPlaylist('spacemountainlive', 'spacemountainlive');
    return NextResponse.json(media, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('[BRB] Automatic fallback playlist failed:', error);
    return NextResponse.json({ clips: [], gifs: [] }, { status: 503 });
  }
}
