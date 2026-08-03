import * as fs from 'fs/promises';
import { resolve } from 'path';
import { tenantPath } from '../lib/tenant';

// A restarted process must never replay an old Discord DM backlog. The first
// sweep for each tenant establishes a fresh high-water mark from Discord, then
// later sweeps resume from the persisted cursor normally.
const tenantsAwaitingFreshBaseline = new Set<string>();
let processBaselineInitialized = false;

function ensureProcessBaselineState(): void {
  if (processBaselineInitialized) return;
  processBaselineInitialized = true;
}

function compareDiscordMessageIds(left: string | null | undefined, right: string | null | undefined): number {
  if (!left && !right) return 0;
  if (!left) return -1;
  if (!right) return 1;

  try {
    const leftId = BigInt(left);
    const rightId = BigInt(right);
    if (leftId === rightId) return 0;
    return leftId > rightId ? 1 : -1;
  } catch {
    if (left === right) return 0;
    return left > right ? 1 : -1;
  }
}

export function getDmSweepStatePath(tenantId: string): string {
  return tenantPath(tenantId, 'data/discord-dm-sweep-state.json');
}

export async function loadDmLastMessageId(tenantId: string): Promise<string | null> {
  ensureProcessBaselineState();
  if (!tenantsAwaitingFreshBaseline.has(tenantId)) {
    tenantsAwaitingFreshBaseline.add(tenantId);
    return null;
  }

  try {
    const raw = await fs.readFile(getDmSweepStatePath(tenantId), 'utf-8');
    const parsed = JSON.parse(raw);
    return typeof parsed?.lastMessageId === 'string' ? parsed.lastMessageId : null;
  } catch {
    return null;
  }
}

export async function saveDmLastMessageId(tenantId: string, lastMessageId: string): Promise<void> {
  try {
    const statePath = getDmSweepStatePath(tenantId);
    await fs.mkdir(resolve(statePath, '..'), { recursive: true });
    await fs.writeFile(statePath, JSON.stringify({ lastMessageId }, null, 2), 'utf-8');
  } catch {}
}

export async function markDmMessageHandled(tenantId: string, messageId?: string | null): Promise<void> {
  const normalizedMessageId = typeof messageId === 'string' ? messageId.trim() : '';
  if (!tenantId || !normalizedMessageId) return;

  // Directly handled messages are themselves a valid current baseline. Mark
  // the tenant initialized before reading so this path does not discard a live
  // message merely because it was the first event after restart.
  tenantsAwaitingFreshBaseline.add(tenantId);
  const currentLastMessageId = await loadDmLastMessageId(tenantId);
  if (compareDiscordMessageIds(normalizedMessageId, currentLastMessageId) < 0) {
    return;
  }

  await saveDmLastMessageId(tenantId, normalizedMessageId);
}
