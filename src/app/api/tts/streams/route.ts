import { NextResponse } from 'next/server';
import { readFile } from 'node:fs/promises';
import { listTenants, tenantPath } from '@/lib/tenant';
import { getActiveTtsConsumer } from '@/services/tts-consumer-presence';

export const dynamic = 'force-dynamic';

type StoredTtsState = {
  queue?: Array<{ cursor?: string; addedAt?: string }>;
  lastServedAt?: string | null;
};

async function describeTenant(tenantId: string) {
  let state: StoredTtsState = {};
  let label = tenantId;

  try {
    state = JSON.parse(await readFile(tenantPath(tenantId, 'data/tts-current-state.json'), 'utf8'));
  } catch {}

  try {
    const tokens = JSON.parse(await readFile(tenantPath(tenantId, 'tokens/twitch-tokens.json'), 'utf8'));
    label = String(tokens.broadcasterUsername || tokens.loginUsername || tenantId);
  } catch {}

  const queue = Array.isArray(state.queue) ? state.queue : [];
  const latest = queue[queue.length - 1];
  const presence = getActiveTtsConsumer(tenantId, 'overlay');

  return {
    tenantId,
    label,
    itemCount: queue.length,
    latestCursor: latest?.cursor || null,
    lastActiveAt: latest?.addedAt || state.lastServedAt || null,
    listenerActive: Boolean(presence),
    listenerKind: presence?.kind || null,
  };
}

export async function GET() {
  const tenantIds = (await listTenants()).filter((tenantId) => (
    /^\d{5,20}$/.test(tenantId)
    || /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(tenantId)
  ));
  const streams = await Promise.all(tenantIds.map(describeTenant));
  streams.sort((a, b) => (
    String(b.lastActiveAt || '').localeCompare(String(a.lastActiveAt || ''))
    || a.label.localeCompare(b.label)
  ));
  return NextResponse.json({ streams });
}
