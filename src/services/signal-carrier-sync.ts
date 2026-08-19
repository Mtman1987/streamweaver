import { syncSignalCarrierChannels } from './twitch-client';

const DSH_BASE_URL = String(
  process.env.DISCORD_STREAM_HUB_URL
  || process.env.NEXT_PUBLIC_DISCORD_STREAM_HUB_URL
  || 'https://discord-stream-hub-new.fly.dev'
).replace(/\/$/, '');
const DSH_SECRET = String(
  process.env.DSH_SERVICE_SECRET
  || process.env.DSH_CLIENT_SECRET
  || process.env.BOT_SECRET_KEY
  || ''
).trim();
const SIGNAL_CARRIER_SYNC_MS = Math.max(30_000, Number(process.env.SIGNAL_CARRIER_SYNC_MS || 120_000));

let timer: NodeJS.Timeout | null = null;
let syncInFlight: Promise<void> | null = null;

function normalizeChannel(value: unknown): string {
  return String(value || '')
    .trim()
    .replace(/^#/, '')
    .replace(/^https?:\/\/(www\.)?twitch\.tv\//i, '')
    .replace(/\/+$/, '')
    .replace(/[^a-z0-9_]/gi, '')
    .toLowerCase()
    .slice(0, 25);
}

async function fetchSignalCarrierRoster(): Promise<string[]> {
  if (!DSH_SECRET) throw new Error('DSH service secret is not configured');
  const response = await fetch(`${DSH_BASE_URL}/api/internal/signal/carriers`, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${DSH_SECRET}`,
    },
    cache: 'no-store',
    signal: typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
      ? AbortSignal.timeout(5000)
      : undefined,
  });
  if (!response.ok) {
    throw new Error(`DSH Signal carrier roster failed: ${response.status} ${await response.text().catch(() => '')}`);
  }
  const payload = await response.json().catch(() => null) as any;
  return Array.from(new Set(
    (Array.isArray(payload?.channels) ? payload.channels : [])
      .map(normalizeChannel)
      .filter(Boolean),
  )).sort();
}

export async function syncSignalCarrierRosterOnce(): Promise<void> {
  if (syncInFlight) return syncInFlight;
  syncInFlight = (async () => {
    const channels = await fetchSignalCarrierRoster();
    const result = await syncSignalCarrierChannels(channels);
    if (result.joined.length || result.parted.length) {
      console.log('[Signal] carrier listener synced', {
        total: result.active.length,
        joined: result.joined,
        parted: result.parted,
      });
    }
  })().finally(() => {
    syncInFlight = null;
  });
  return syncInFlight;
}

export function startSignalCarrierRosterSync(): void {
  if (timer || process.env.SIGNAL_CARRIER_SYNC_ENABLED === 'false') return;
  void syncSignalCarrierRosterOnce().catch((error) => {
    console.warn('[Signal] carrier listener initial sync failed:', error instanceof Error ? error.message : String(error));
  });
  timer = setInterval(() => {
    void syncSignalCarrierRosterOnce().catch((error) => {
      console.warn('[Signal] carrier listener sync failed:', error instanceof Error ? error.message : String(error));
    });
  }, SIGNAL_CARRIER_SYNC_MS);
  timer.unref?.();
}
