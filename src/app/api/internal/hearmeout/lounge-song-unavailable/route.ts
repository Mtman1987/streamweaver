import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';

import { sendTwitchChatMessage } from '@/services/twitch';

export async function POST(request: NextRequest) {
  const expected = String(process.env.HMO_WORKER_SHARED_SECRET || '');
  const supplied = String(request.headers.get('authorization') || '').replace(/^Bearer /i, '');
  const a = Buffer.from(expected);
  const b = Buffer.from(supplied);
  if (!expected || a.length !== b.length || !timingSafeEqual(a, b)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const body = await request.json().catch(() => null);
  const title = String(body?.title || '').replace(/[\r\n\t]/g, ' ').trim().slice(0, 120);
  if (!title) return NextResponse.json({ error: 'Song title required' }, { status: 400 });
  try {
    await sendTwitchChatMessage(`Stella couldn't find a playable upload of ${title} after checking the top five results. I'll try another song.`, 'bot', 'spacemountainlive', 'spacemountainlive');
    return NextResponse.json({ success: true });
  } catch (error) {
    console.warn('[Lounge] Could not deliver song failure to chat:', error);
    return NextResponse.json({ error: 'Chat delivery failed' }, { status: 502 });
  }
}
