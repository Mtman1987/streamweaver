// Standalone in-memory broadcast logs for !say, keyed by tenant.
// tenantId selects the stream group, not access control.
export type SayQueueItem = {
  id: number;
  audioUrl: string;
  addedAt: string;
};

const sayQueues = new Map<string, SayQueueItem[]>();
const saySequenceByTenant = new Map<string, number>();
const MAX_SAY_ITEMS_PER_TENANT = 100;

export function normalizeSayQueueTenant(tenantId: unknown): string {
  const normalized = String(tenantId || '').trim();
  return normalized || 'global';
}

export function getSayQueue(tenantId?: unknown): SayQueueItem[] {
  const key = normalizeSayQueueTenant(tenantId);
  let queue = sayQueues.get(key);
  if (!queue) {
    queue = [];
    sayQueues.set(key, queue);
  }
  return queue;
}

export function addSayQueueItem(tenantId: unknown, audioUrl: string): SayQueueItem {
  const key = normalizeSayQueueTenant(tenantId);
  const nextId = (saySequenceByTenant.get(key) || 0) + 1;
  saySequenceByTenant.set(key, nextId);

  const queue = getSayQueue(key);
  const item = {
    id: nextId,
    audioUrl,
    addedAt: new Date().toISOString(),
  };
  queue.push(item);
  if (queue.length > MAX_SAY_ITEMS_PER_TENANT) {
    queue.splice(0, queue.length - MAX_SAY_ITEMS_PER_TENANT);
  }
  return item;
}

export function listSayQueueStreams() {
  return Array.from(sayQueues.entries())
    .map(([tenantId, queue]) => ({
      tenantId,
      itemCount: queue.length,
      latestId: queue[queue.length - 1]?.id || 0,
      lastActiveAt: queue[queue.length - 1]?.addedAt || null,
    }))
    .sort((a, b) => String(b.lastActiveAt || '').localeCompare(String(a.lastActiveAt || '')));
}
