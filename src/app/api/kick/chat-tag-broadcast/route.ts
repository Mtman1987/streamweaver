import { NextRequest, NextResponse } from 'next/server';
import { getAllKickInstances } from '@/services/kick';

export const dynamic = 'force-dynamic';

function getSecret(request: NextRequest, body: any): string {
  const authHeader = request.headers.get('authorization') || '';
  if (authHeader.startsWith('Bearer ')) {
    return authHeader.slice('Bearer '.length).trim();
  }
  return String(request.headers.get('x-bot-secret') || body?.secret || '').trim();
}

function normalizeChannel(value: unknown): string {
  return String(value || '').trim().replace(/^@/, '').toLowerCase();
}

export async function POST(request: NextRequest) {
  let body: any = {};
  try {
    const raw = await request.text();
    body = raw.trim() ? JSON.parse(raw) : {};
  } catch {
    return NextResponse.json({ error: 'invalid JSON payload' }, { status: 400 });
  }

  const expectedSecret = String(process.env.BOT_SECRET_KEY || '').trim();
  if (!expectedSecret || getSecret(request, body) !== expectedSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const message = String(body?.message || '').trim();
  const channels: string[] = Array.isArray(body?.channels)
    ? body.channels.map(normalizeChannel).filter(Boolean)
    : [];

  if (!message) {
    return NextResponse.json({ error: 'message required' }, { status: 400 });
  }

  if (channels.length === 0) {
    return NextResponse.json({ success: true, sent: 0, skipped: 0, reason: 'no channels requested' });
  }

  const requested = new Set(channels);
  const instances = Array.from(getAllKickInstances().values());
  let sent = 0;
  let skipped = 0;
  const errors: Array<{ channel: string; error: string }> = [];

  for (const channel of requested) {
    const kick = instances.find((instance) => normalizeChannel(instance.getChannelName()) === channel);
    if (!kick || !kick.isConnected()) {
      skipped += 1;
      continue;
    }

    try {
      await kick.sendChatMessage(message);
      sent += 1;
    } catch (error: any) {
      errors.push({ channel, error: error?.message || String(error) });
    }
  }

  return NextResponse.json({
    success: errors.length === 0,
    sent,
    skipped,
    errors,
  }, { status: errors.length ? 207 : 200 });
}
