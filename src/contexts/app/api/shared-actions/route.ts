import { NextResponse } from 'next/server';

export async function GET() {
  try {
    return NextResponse.json({ actions: [] });
  } catch {
    return NextResponse.json({ error: 'Failed to load shared actions', actions: [] }, { status: 500 });
  }
}