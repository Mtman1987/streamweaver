import { clearSpmtServiceTokenCache, getSpmtServiceToken } from '../lib/spmt-service-token';
import { syncSignalCarrierChannels } from './twitch-client';

const DSH_BASE_URL = String(
  process.env.DISCORD_STREAM_HUB_URL
  || process.env.NEXT_PUBLIC_DISCORD_STREAM_HUB_URL
  || 'https://discord-stream-hub-new.fly.dev'
).replace(/\/$/, '');
const CHAT_TAG_BASE_URL = String(
  process.env.CHAT_TAG_BASE_URL
  || process.env.NEXT_PUBLIC_CHAT_TAG_URL
  || 'https://chat-tag-new.fly.dev'
).replace(/\/$/, '');
const DSH_SECRET = String(
  process.env.DSH_SERVICE_SECRET
  || process.env.DSH_CLIENT_SECRET
  || process.env.BOT_SECRET_KEY
  || ''
).trim();
const CHAT_TAG_BLACKLIST_SCOPE = 'chat-tag:blacklist:read';
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

function requestTimeout(): AbortSignal | undefined {
  return typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
    ? AbortSignal.timeout(5000)
    : undefined;
}

async function fetchSignalCarrierRoster(): Promise<string[]> {
  if (!DSH_SECRET) throw new Error('DSH service secret is not configured');
  const response = await fetch(`${DSH_BASE_URL}/api/internal/signal/carriers`, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${DSH_SECRET}`,
    },
    cache: 'no-store',
    signal: requestTimeout(),
  });
  if (!response.ok) {
    throw new Error(`DSH Signal carrier roster failed: ${response.status} ${await response.text().catch(() => '')}`);
  }
  const payload = await response.json().catch(() => null) as any;
  const rawChannels: unknown[] = Array.isArray(payload?.channels) ? payload.channels : [];
  const channels = rawChannels
    .map(normalizeChannel)
    .filter((channel): channel is string => Boolean(channel));
  return [...new Set<string>(channels)].sort();
}

async function fetchChatTagBlacklistAttempt(token: string): Promise<Response> {
  return fetch(`${CHAT_TAG_BASE_URL}/api/bot/blacklist`, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    },
    cache: 'no-store',
    signal: requestTimeout(),
  });
}

async function fetchChatTagBotBlacklist(): Promise<Set<string>> {
  let token = await getSpmtServiceToken([CHAT_TAG_BLACKLIST_SCOPE]);
  let response = await fetchChatTagBlacklistAttempt(token);

  if (response.status === 401) {
    await response.body?.cancel().catch(() => undefined);
    clearSpmtServiceTokenCache([CHAT_TAG_BLACKLIST_SCOPE]);
    token = await getSpmtServiceToken([CHAT_TAG_BLACKLIST_SCOPE]);
    response = await fetchChatTagBlacklistAttempt(token);
  }

  if (!response.ok) {
    throw new Error(`ChatTag bot blacklist failed: ${response.status} ${await response.text().catch(() => '')}`);
  }
  const payload = await response.json().catch(() => null) as any;
  const rawChannels: unknown[] = Array.isArray(payload?.blacklisted) ? payload.blacklisted : [];
  return new Set(
    rawChannels
      .map(normalizeChannel)
      .filter((channel): channel is string => Boolean(channel)),
  );
}

export async function syncSignalCarrierRosterOnce(): Promise<void> {
  if (syncInFlight) return syncInFlight;
  syncInFlight = (async () => {
    // Do not join or change community-bot carrier channels unless the canonical
    // ChatTag no-bot list is available. Opt-out takes precedence over shoutouts.
    const [channels, botBlacklist] = await Promise.all([
      fetchSignalCarrierRoster(),
      fetchChatTagBotBlacklist(),
    ]);
    const excluded = channels.filter((channel) => botBlacklist.has(channel));
    const eligibleChannels = channels.filter((channel) => !botBlacklist.has(channel));
    const result = await syncSignalCarrierChannels(eligibleChannels);
    if (result.joined.length || result.parted.length || excluded.length) {
      console.log('[Signal] carrier listener synced', {
        total: result.active.length,
        joined: result.joined,
        parted: result.parted,
        chatTagBotOptOuts: excluded,
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
