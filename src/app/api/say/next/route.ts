import { NextResponse } from 'next/server';
import { sayQueue } from '../_store';

export const dynamic = 'force-dynamic';

export async function GET() {
  const text = sayQueue.shift();
  return NextResponse.json({ text: text || null });
}
