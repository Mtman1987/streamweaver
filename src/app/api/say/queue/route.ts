import { NextRequest, NextResponse } from 'next/server';
import { sayQueue } from '../_store';

export async function POST(request: NextRequest) {
  const { text } = await request.json().catch(() => ({ text: '' }));
  if (!text) return NextResponse.json({ ok: false, error: 'empty' });
  sayQueue.push(String(text).slice(0, 500));
  return NextResponse.json({ ok: true, queued: sayQueue.length });
}
