import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST() {
  return NextResponse.json({
    error: 'Bingo transcription is paused. Stream and microphone listeners are disabled while low-cost transcription is evaluated.',
    code: 'BINGO_TRANSCRIPTION_PAUSED',
  }, { status: 410 });
}
