import { createDiscordDmChannel, sendDiscordMessage } from './discord-local';
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
