import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { tenantPath } from '@/lib/tenant';

export const COMMERCIAL_MIN_ACTIVE_MS = 180_000;
export const COMMERCIAL_COOLDOWN_MS = 300_000;

export type CommercialBreakPhase = 'IDLE' | 'ACTIVE' | 'COOLDOWN';

export type CommercialBreakState = {
  schemaVersion: 1;
  phase: CommercialBreakPhase;
  breakStartedAt: number;
  activeUntil: number;
  cooldownUntil: number;
  lastEventMessageId: string;
  lastEventStartedAt: number;
  durationSeconds: number;
  isAutomatic: boolean;
  updatedAt: number;
};

const empty = (): CommercialBreakState => ({
  schemaVersion: 1,
  phase: 'IDLE',
  breakStartedAt: 0,
  activeUntil: 0,
  cooldownUntil: 0,
  lastEventMessageId: '',
  lastEventStartedAt: 0,
  durationSeconds: 0,
  isAutomatic: false,
  updatedAt: 0,
});

function filePath(tenantId: string) {
  return tenantPath(tenantId, 'data/commercial-break-state.json');
}

function normalized(value: Partial<CommercialBreakState> | null): CommercialBreakState {
  const state = { ...empty(), ...(value || {}), schemaVersion: 1 as const };
  const now = Date.now();
  const hardActiveCap = state.breakStartedAt > 0
    ? state.breakStartedAt + Math.max(COMMERCIAL_MIN_ACTIVE_MS, Math.max(0, Number(state.durationSeconds) || 0) * 1000)
    : 0;
  if (state.activeUntil > hardActiveCap && hardActiveCap > 0) state.activeUntil = hardActiveCap;
  if (state.cooldownUntil > state.activeUntil + COMMERCIAL_COOLDOWN_MS) state.cooldownUntil = state.activeUntil + COMMERCIAL_COOLDOWN_MS;
  if (state.activeUntil > now) state.phase = 'ACTIVE';
  else if (state.cooldownUntil > now) state.phase = 'COOLDOWN';
  else state.phase = 'IDLE';
  return state;
}

async function readStored(tenantId: string): Promise<CommercialBreakState> {
  try {
    return normalized(JSON.parse(await fs.readFile(filePath(tenantId), 'utf8')));
  } catch {
    return empty();
  }
}

async function writeStored(tenantId: string, state: CommercialBreakState) {
  const target = filePath(tenantId);
  await fs.mkdir(dirname(target), { recursive: true });
  const temporary = target + '.' + process.pid + '.' + randomUUID() + '.tmp';
  await fs.writeFile(temporary, JSON.stringify(state, null, 2), 'utf8');
  await fs.rename(temporary, target);
}

function broadcast(tenantId: string, state: CommercialBreakState) {
  if (typeof (global as any).broadcast === 'function') {
    (global as any).broadcast({ type: 'commercial-break-state', payload: state }, tenantId);
  }
}

export async function getCommercialBreakState(tenantId: string): Promise<CommercialBreakState> {
  const stored = await readStored(tenantId);
  const current = normalized(stored);
  if (current.phase !== stored.phase) {
    current.updatedAt = Date.now();
    await writeStored(tenantId, current);
  }
  return current;
}

export async function beginCommercialBreak(input: {
  tenantId: string;
  messageId: string;
  startedAt: string;
  durationSeconds: number;
  isAutomatic: boolean;
}): Promise<{ state: CommercialBreakState; accepted: boolean; reason: string }> {
  const tenantId = String(input.tenantId || '').trim();
  const messageId = String(input.messageId || '').trim();
  if (!tenantId || !messageId) throw new Error('Commercial break requires tenant and EventSub message ID');

  const now = Date.now();
  const start = Number.isFinite(Date.parse(input.startedAt)) ? Date.parse(input.startedAt) : now;
  const durationSeconds = Math.max(0, Math.round(Number(input.durationSeconds) || 0));
  const candidateUntil = start + Math.max(COMMERCIAL_MIN_ACTIVE_MS, durationSeconds * 1000);
  const current = await getCommercialBreakState(tenantId);

  if (current.lastEventMessageId === messageId) {
    return { state: current, accepted: false, reason: 'duplicate-message-id' };
  }

  if (current.phase === 'ACTIVE') {
    const next = {
      ...current,
      lastEventMessageId: messageId,
      lastEventStartedAt: start,
      updatedAt: now,
    };
    await writeStored(tenantId, next);
    return { state: next, accepted: false, reason: 'active-duplicate' };
  }

  if (current.phase === 'COOLDOWN' && now < current.cooldownUntil) {
    const next = { ...current, lastEventMessageId: messageId, lastEventStartedAt: start, updatedAt: now };
    await writeStored(tenantId, next);
    return { state: next, accepted: false, reason: 'cooldown' };
  }

  const activeUntil = candidateUntil;
  const next: CommercialBreakState = {
    schemaVersion: 1,
    phase: 'ACTIVE',
    breakStartedAt: start,
    activeUntil,
    cooldownUntil: activeUntil + COMMERCIAL_COOLDOWN_MS,
    lastEventMessageId: messageId,
    lastEventStartedAt: start,
    durationSeconds,
    isAutomatic: Boolean(input.isAutomatic),
    updatedAt: now,
  };
  await writeStored(tenantId, next);
  broadcast(tenantId, next);
  return { state: next, accepted: true, reason: 'started' };
}
