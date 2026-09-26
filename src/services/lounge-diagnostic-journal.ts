import { createDiscordDmChannel, sendDiscordMessage } from './discord-local';
import { startBRB } from './brb-clips';
import { getConfiguredAppUrl } from '@/lib/runtime-origin';

export type LoungeDiagnosticEntry = { at: string; level: 'info' | 'warn' | 'critical'; subsystem: string; event: string; detail: string };
const MAX_ENTRIES = 80, FAILURE_THRESHOLD = 3, DM_COOLDOWN_MS = 30 * 60 * 1000;
const OWNER_DISCORD_ID = String(process.env.STREAMWEAVER_OWNER_DISCORD_ID || process.env.NEXT_PUBLIC_HARDCODED_ADMIN_DISCORD_ID || '767875979561009173').trim();
const entries: LoungeDiagnosticEntry[] = [];
const failures = new Map<string, number>(), lastAlertAt = new Map<string, number>(), lastFacts = new Map<string, string>();

function record(entry: Omit<LoungeDiagnosticEntry, 'at'>) {
  const value = { ...entry, at: new Date().toISOString() };
  entries.push(value);
  if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
  console.log(`[Lounge Journal] [${value.level}] ${value.subsystem} ${value.event}: ${value.detail}`);
  return value;
}
export function getLoungeDiagnosticJournal(limit = 20) { return entries.slice(-Math.max(1, Math.min(MAX_ENTRIES, limit))); }

async function alertOwner(key: string, detail: string) {
  const now = Date.now();
  if (!OWNER_DISCORD_ID || now - (lastAlertAt.get(key) || 0) < DM_COOLDOWN_MS) return;
  try {
    const dm = await createDiscordDmChannel(OWNER_DISCORD_ID);
    await sendDiscordMessage(dm.id, `🚨 **Stella Lounge needs attention**\n${detail}\n\nI saw this fail ${FAILURE_THRESHOLD} checks in a row and it has not recovered on its own.`);
    lastAlertAt.set(key, now);
    record({ level: 'critical', subsystem: key, event: 'owner-dm-sent', detail });
  } catch (error) { console.warn('[Lounge Journal] Owner DM failed:', error); }
}
async function reportPlaybackFailure(key: string, detail: string) {
  const count = (failures.get(key) || 0) + 1;
  failures.set(key, count);
  record({ level: count >= FAILURE_THRESHOLD ? 'critical' : 'warn', subsystem: key, event: 'playback-failed', detail: `${detail} (check ${count}/${FAILURE_THRESHOLD})` });
  if (count === FAILURE_THRESHOLD) {
    record({ level: 'critical', subsystem: key, event: 'brb-fallback-start', detail: 'Holding the Lounge on BRB while playback is unhealthy.' });
    void startBRB('spacemountainlive', 'spacemountainlive').catch(error =>
      record({ level: 'critical', subsystem: key, event: 'brb-fallback-error', detail: error instanceof Error ? error.message : String(error) })
    );
    await alertOwner(key, `${detail}\nBRB has been started to hold the program. Suggested checks: inspect HearMeOut's current music session, Lounge renderer status and playback errors. I will keep hosting chat while BRB runs; use !back after playback is repaired.`);
  }
}

async function checkUrl(key: string, url: string, label: string) {
  try {
    const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const previous = failures.get(key) || 0;
    failures.set(key, 0);
    if (previous >= FAILURE_THRESHOLD) record({ level: 'info', subsystem: key, event: 'recovered', detail: `${label} recovered after ${previous} failed checks.` });
    return response;
  } catch (error) {
    const count = (failures.get(key) || 0) + 1; failures.set(key, count);
    const detail = `${label} failed health check ${count}x: ${error instanceof Error ? error.message : String(error)}`;
    record({ level: count >= FAILURE_THRESHOLD ? 'critical' : 'warn', subsystem: key, event: 'health-failed', detail });
    if (count === FAILURE_THRESHOLD) await alertOwner(key, detail);
    return null;
  }
}
export async function runLoungeDiagnosticTick() {
  const base = getConfiguredAppUrl();
  const status = await checkUrl('lounge-overlay-state', `${base}/api/lounge/status-strip`, 'Lounge overlay state');
  await checkUrl('spotlight-player', 'https://spmt.live/lounge-live-spotlight.html?v=direct-twitch-1', 'Direct Spotlight player');
  // Queue success alone cannot prove that the song reached the broadcast.
  // Check the renderer only while the music lane is supposed to be playing.
  try {
    const [sessionResponse, rendererResponse] = await Promise.all([
      fetch('https://hearmeout-main.fly.dev/api/watch/sessions/watch-room-system-spacemountainlive-lounge-music/state', { cache: 'no-store', signal: AbortSignal.timeout(8000) }),
      fetch('https://hearmeout-main.fly.dev/api/lounge-media/status', { cache: 'no-store', signal: AbortSignal.timeout(8000) }),
    ]);
    if (!sessionResponse.ok || !rendererResponse.ok) throw new Error(`music state HTTP ${sessionResponse.status}; renderer HTTP ${rendererResponse.status}`);
    const session: any = await sessionResponse.json();
    const renderer: any = await rendererResponse.json();
    const key = 'lounge-music-playback';
    if (session?.current && session?.playback?.status === 'playing') {
      const title = String(session.current.item?.title || '').trim();
      if (!renderer?.ready || !renderer?.mediaHealthy || (title && renderer.mediaTitle !== title)) {
        await reportPlaybackFailure(key, `Music is playing in the queue (${title || 'unknown'}) but the Lounge renderer reports ${renderer?.mediaTitle || 'no title'}, ready=${Boolean(renderer?.ready)}, healthy=${Boolean(renderer?.mediaHealthy)}, mode=${renderer?.playerMode || 'unknown'}, error=${renderer?.error || 'none'}.`);
      } else if (failures.get(key)) {
        failures.set(key, 0);
        record({ level: 'info', subsystem: key, event: 'recovered', detail: `Lounge renderer is playing ${title}.` });
      }
    } else failures.set(key, 0);
  } catch (error) {
    record({ level: 'warn', subsystem: 'lounge-music-playback', event: 'probe-unavailable', detail: error instanceof Error ? error.message : String(error) });
  }
  if (!status) return;
  try {
    const payload: any = await status.json(); const data = payload?.data || payload;
    const facts = { spotlight: String(data?.spotlight?.displayName || 'none'), media: String(data?.media?.title || 'none'), games: Array.isArray(data?.games) ? data.games.map((g: any) => g?.name).filter(Boolean).join(', ') || 'none' : 'none' };
    for (const [name, value] of Object.entries(facts)) {
      const old = lastFacts.get(name);
      if (old !== undefined && old !== value) record({ level: 'info', subsystem: 'lounge-overlay', event: `${name}-changed`, detail: `${name}: ${old} -> ${value}` });
      lastFacts.set(name, value);
    }
  } catch (error) { record({ level: 'warn', subsystem: 'lounge-overlay-state', event: 'invalid-status', detail: error instanceof Error ? error.message : String(error) }); }
}
