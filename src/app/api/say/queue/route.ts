import { NextRequest, NextResponse } from 'next/server';
import { sayQueue } from '../_store';
import { generateTTS } from '@/services/tts-provider';

export async function POST(request: NextRequest) {
  const { text } = await request.json().catch(() => ({ text: '' }));
  if (!text) return NextResponse.json({ ok: false, error: 'empty' });
  const cleanText = String(text).slice(0, 500);
  try {
    const audioDataUri = await generateTTS(cleanText, undefined, undefined);
    sayQueue.push(audioDataUri);
    return NextResponse.json({ ok: true, queued: sayQueue.length });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'tts-failed' });
  }
}
