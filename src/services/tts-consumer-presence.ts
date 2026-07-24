export type TtsConsumerScope = 'overlay' | 'say';
export type TtsConsumerKind = 'overlay' | 'listener' | 'dashboard' | 'say' | 'mixer' | 'other';

type PresenceRecord = {
  lastSeenAt: number;
  kind: TtsConsumerKind;
};

// OBS may throttle browser-source timers while a scene is hidden or during a
// scene transition. Queue polling renews this presence too, and this grace
// period prevents a brief throttle/reconnect from disabling paid synthesis.
const TTS_CONSUMER_TTL_MS = 5 * 60_000;

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
  presenceMap().set(key, { lastSeenAt: Date.now(), kind });
  return true;
}

export function getActiveTtsConsumer(
  tenantId: unknown,
  scope: TtsConsumerScope = 'overlay',
  now = Date.now(),
): PresenceRecord | null {
  const key = presenceKey(tenantId, scope);
  if (!key) return null;
  const record = presenceMap().get(key);
  if (!record) return null;
  if (now - record.lastSeenAt > TTS_CONSUMER_TTL_MS) {
    presenceMap().delete(key);
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
