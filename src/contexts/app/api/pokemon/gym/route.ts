import { NextRequest, NextResponse } from 'next/server';

export async function GET() {
  const { getQueue, getActiveBattle } = require('@/services/gym-battle');
  return NextResponse.json({
    queue: getQueue(),
    activeBattle: getActiveBattle() ? true : false
  });
}

export async function POST(request: NextRequest) {
  const body = await request.json();

  if (body.action === 'next') {
    const { startNextBattle } = require('@/services/gym-battle');
    await startNextBattle();
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
