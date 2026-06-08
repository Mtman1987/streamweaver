export type DashboardActivityEntry = {
  id: string;
  tenantId?: string;
  platform: 'Twitch' | 'Discord' | 'System';
  user: string;
  message: string;
  timestamp: string;
  color?: string;
};

const MAX_ENTRIES = 100;
const activityByTenant = new Map<string, DashboardActivityEntry[]>();

function tenantKey(tenantId?: string) {
  return tenantId || 'global';
}

export function recordDashboardActivity(entry: Omit<DashboardActivityEntry, 'timestamp'> & { timestamp?: string }) {
  const key = tenantKey(entry.tenantId);
  const current = activityByTenant.get(key) || [];
  const next = [
    ...current,
    {
      ...entry,
      timestamp: entry.timestamp || new Date().toISOString(),
    },
  ].slice(-MAX_ENTRIES);
  activityByTenant.set(key, next);
}

export function readDashboardActivity(tenantId?: string, limit = 50): DashboardActivityEntry[] {
  const entries = activityByTenant.get(tenantKey(tenantId)) || [];
  return entries.slice(-Math.max(1, Math.min(limit, MAX_ENTRIES)));
}
