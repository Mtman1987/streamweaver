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
  const tenantIds = await listTenants();
  const streams = await Promise.all(tenantIds.map(describeTenant));
  streams.sort((a, b) => (
    String(b.lastActiveAt || '').localeCompare(String(a.lastActiveAt || ''))
    || a.label.localeCompare(b.label)
  ));
  return NextResponse.json({ streams });
}
