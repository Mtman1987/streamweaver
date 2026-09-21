import { NextRequest, NextResponse } from 'next/server';
import { getTenantFromRequest } from '@/lib/tenant-context';
import { readUserConfig } from '@/lib/user-config';

export const dynamic = 'force-dynamic';

const CHAT_TAG_URL = String(
  process.env.CHAT_TAG_BASE_URL || process.env.NEXT_PUBLIC_CHAT_TAG_URL || 'https://chat-tag-new.fly.dev',
).replace(/\/+$/, '');

function normalizeChannel(value: unknown) {
  return String(value || '').trim().toLowerCase().replace(/^#/, '').replace(/[^a-z0-9_]/g, '').slice(0, 25);
}

export async function POST(request: NextRequest) {
  const session = getTenantFromRequest(request);
  if (!session?.tenantId) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const config = await readUserConfig(session.tenantId);
  const channel = normalizeChannel(config.TWITCH_BROADCASTER_USERNAME || config.NEXT_PUBLIC_TWITCH_BROADCASTER_USERNAME);
  const text = String(body.text || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 1_000);
  if (!channel || !text) return NextResponse.json({ error: 'Configured Twitch channel and text are required.' }, { status: 400 });
  const secret = String(process.env.CHAT_TAG_SECRET || process.env.BOT_SECRET_KEY || '').trim();
  if (!secret) return NextResponse.json({ error: 'Nebula service secret is not configured.' }, { status: 503 });
  try {
    const response = await fetch(`${CHAT_TAG_URL}/api/game-hub/bingo-transcript`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-bot-secret': secret },
      body: JSON.stringify({ channel, text }),
      cache: 'no-store',
      signal: typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(5_000) : undefined,
    });
    const payload = await response.json().catch(() => ({}));
    return NextResponse.json(payload, { status: response.status });
  } catch (error) {
    console.warn('[NebulaBingo] transcript forward failed', error);
    return NextResponse.json({ error: 'Nebula Bingo is unavailable.' }, { status: 502 });
  }
}
