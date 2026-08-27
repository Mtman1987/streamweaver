import { NextRequest, NextResponse } from 'next/server';
import { recordSignalClueClick } from '@/services/signal-system';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const id = String(request.nextUrl.searchParams.get('id') || '').trim();
  if (id) {
    await recordSignalClueClick(id).catch((error) => {
      console.warn('[Signal] click tracking failed', error);
    });
  }
  return NextResponse.redirect('https://spmt.live/signal/', 302);
}
