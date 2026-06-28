// Standalone in-memory queues for !say, keyed by tenant. These are open
// listener queues; tenantId selects the stream group, not access control.
const sayQueues = new Map<string, string[]>();

export function normalizeSayQueueTenant(tenantId: unknown): string {
  const normalized = String(tenantId || '').trim();
  return normalized || 'global';
}

export function getSayQueue(tenantId?: unknown): string[] {
  const key = normalizeSayQueueTenant(tenantId);
  let queue = sayQueues.get(key);
  if (!queue) {
    queue = [];
    sayQueues.set(key, queue);
  }
  return queue;
}
