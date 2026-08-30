import type { CardPackOpenedEvent } from '@/lib/card-pack-event';
import { buildCardPackRenderUrl } from '@/lib/card-pack-event';

const DSH_URL = String(
  process.env.DISCORD_STREAM_HUB_URL
    || process.env.NEXT_PUBLIC_DISCORD_STREAM_HUB_URL
    || 'https://discord-stream-hub-new.fly.dev',
).replace(/\/$/, '');

function secret() {
  return String(process.env.DSH_SERVICE_SECRET || process.env.DSH_CLIENT_SECRET || process.env.BOT_SECRET_KEY || '').trim();
}

async function request(path: string, init: RequestInit) {
  const token = secret();
  if (!token) throw new Error('DSH service credential is not configured');
  const response = await fetch(`${DSH_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.headers || {}),
    },
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`DSH card pack render failed ${response.status}: ${await response.text()}`);
  return response.json() as Promise<any>;
}

export async function queueCardPackGif(event: CardPackOpenedEvent) {
  const data = await request('/api/internal/card-pack/render', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      eventId: event.eventId,
      source: event.game,
      renderUrl: buildCardPackRenderUrl(event),
    }),
  });
  return data.job as { id: string; status: string; gifUrl?: string };
}

export async function waitForCardPackGif(eventId: string, timeoutMs = 120_000): Promise<string | null> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const data = await request(`/api/internal/card-pack/render?id=${encodeURIComponent(eventId)}`, { method: 'GET' });
    const job = data?.job;
    if (job?.status === 'ready' && /^https?:\/\//i.test(String(job.gifUrl || ''))) return String(job.gifUrl);
    if (job?.status === 'failed') return null;
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  return null;
}
