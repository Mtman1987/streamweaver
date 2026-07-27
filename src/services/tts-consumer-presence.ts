import crypto from 'node:crypto';
import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export type TtsConsumerScope = 'overlay' | 'say';
export type TtsConsumerKind = 'overlay' | 'listener' | 'dashboard' | 'say' | 'mixer' | 'other';

type PresenceRecord = {
  lastSeenAt: number;
  kind: TtsConsumerKind;
  lastPersistedAt?: number;
};

// OBS may throttle browser-source timers while a scene is hidden or during a
// scene transition. Queue polling renews this presence too, and this grace
// period prevents a brief throttle/reconnect from disabling paid synthesis.
const TTS_CONSUMER_TTL_MS = 5 * 60_000;
const SHARED_PRESENCE_WRITE_INTERVAL_MS = 5_000;
const SHARED_PRESENCE_DIR = path.join(os.tmpdir(), 'streamweaver-tts-consumer-presence-v1');

function presenceMap(): Map<string, PresenceRecord> {
  const globalState = globalThis as typeof globalThis & {
    __streamweaverTtsConsumerPresence?: Map<string, PresenceRecord>;
  };
  if (!globalState.__streamweaverTtsConsumerPresence) {
    globalState.__streamweaverTtsConsumerPresence = new Map();
  }
  return globalState.__streamweaverTtsConsumerPresence;
}

function normalizeTenantId(tenantId: unknown): string {
  return String(tenantId || '').trim();
}

function presenceKey(tenantId: unknown, scope: TtsConsumerScope): string {
  const normalizedTenant = normalizeTenantId(tenantId);
  return normalizedTenant ? `${scope}:${normalizedTenant}` : '';
}

function sharedPresenceFile(key: string): string {
  const digest = crypto.createHash('sha256').update(key).digest('hex');
  return path.join(SHARED_PRESENCE_DIR, `${digest}.json`);
}

function readSharedPresence(key: string): PresenceRecord | null {
  try {
    const parsed = JSON.parse(readFileSync(sharedPresenceFile(key), 'utf8')) as PresenceRecord;
    if (!Number.isFinite(parsed?.lastSeenAt) || typeof parsed?.kind !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeSharedPresence(key: string, record: PresenceRecord): boolean {
  const file = sharedPresenceFile(key);
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    mkdirSync(SHARED_PRESENCE_DIR, { recursive: true });
    writeFileSync(temporary, JSON.stringify({ lastSeenAt: record.lastSeenAt, kind: record.kind }), 'utf8');
    try {
      renameSync(temporary, file);
    } catch {
      // POSIX replaces atomically. Windows requires the existing destination
      // to be removed first; this fallback keeps local development functional.
      rmSync(file, { force: true });
      renameSync(temporary, file);
    }
    return true;
  } catch {
    try { rmSync(temporary, { force: true }); } catch {}
    return false;
  }
}

function deleteSharedPresence(key: string): void {
  try { rmSync(sharedPresenceFile(key), { force: true }); } catch {}
}

function defaultScopeForKind(kind: TtsConsumerKind): TtsConsumerScope {
  return kind === 'say' || kind === 'mixer' ? 'say' : 'overlay';
}

export function touchTtsConsumer(
  tenantId: unknown,
  kind: TtsConsumerKind,
  scope: TtsConsumerScope = defaultScopeForKind(kind),
): boolean {
  const key = presenceKey(tenantId, scope);
  if (!key) return false;
  const now = Date.now();
  const previous = presenceMap().get(key);
  const record: PresenceRecord = {
    lastSeenAt: now,
    kind,
    lastPersistedAt: previous?.lastPersistedAt || 0,
  };
  if (now - (record.lastPersistedAt || 0) >= SHARED_PRESENCE_WRITE_INTERVAL_MS && writeSharedPresence(key, record)) {
    record.lastPersistedAt = now;
  }
  presenceMap().set(key, record);
  return true;
}

export function getActiveTtsConsumer(
  tenantId: unknown,
  scope: TtsConsumerScope = 'overlay',
  now = Date.now(),
): PresenceRecord | null {
  const key = presenceKey(tenantId, scope);
  if (!key) return null;
  let record = presenceMap().get(key);
  const sharedRecord = readSharedPresence(key);
  if (sharedRecord && (!record || sharedRecord.lastSeenAt > record.lastSeenAt)) {
    record = sharedRecord;
    presenceMap().set(key, sharedRecord);
  }
  if (!record) return null;
  if (now - record.lastSeenAt > TTS_CONSUMER_TTL_MS) {
    presenceMap().delete(key);
    deleteSharedPresence(key);
    return null;
  }
  return record;
}

export function hasActiveTtsConsumer(
  tenantId: unknown,
  scope: TtsConsumerScope = 'overlay',
  now = Date.now(),
): boolean {
  return Boolean(getActiveTtsConsumer(tenantId, scope, now));
}

export const TTS_CONSUMER_PRESENCE_TTL_MS = TTS_CONSUMER_TTL_MS;

export function forgetTtsConsumerMemoryForTest(
  tenantId: unknown,
  scope: TtsConsumerScope = 'overlay',
): void {
  const key = presenceKey(tenantId, scope);
  if (key) presenceMap().delete(key);
}
