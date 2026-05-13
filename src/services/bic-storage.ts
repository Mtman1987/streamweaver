import * as fs from 'fs';
import * as path from 'path';

const BIC_FILE = path.join(process.cwd(), 'data', 'bic-lighters.json');

interface BicData {
  total: number;
  victims: Record<string, number>; // lowercase username -> count
  blacklist: string[]; // lowercase usernames
}

let cache: BicData | null = null;

function ensureDir(): void {
  const dir = path.dirname(BIC_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function load(): BicData {
  if (cache) return cache;
  try {
    if (fs.existsSync(BIC_FILE)) {
      cache = JSON.parse(fs.readFileSync(BIC_FILE, 'utf-8'));
      return cache!;
    }
  } catch {}
  cache = { total: 0, victims: {}, blacklist: [] };
  return cache;
}

function save(): void {
  if (!cache) return;
  ensureDir();
  const tmp = `${BIC_FILE}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(cache, null, 2));
  fs.renameSync(tmp, BIC_FILE);
}

export function getBicData(): BicData {
  return load();
}

export function stealLighter(target: string): { total: number; userCount: number } {
  const data = load();
  const key = target.toLowerCase();
  data.total++;
  data.victims[key] = (data.victims[key] || 0) + 1;
  save();
  return { total: data.total, userCount: data.victims[key] };
}

export function removeLighter(target: string): { total: number; userCount: number } {
  const data = load();
  const key = target.toLowerCase();
  data.victims[key] = Math.max(0, (data.victims[key] || 0) - 1);
  data.total = Math.max(0, data.total - 1);
  if (data.victims[key] === 0) delete data.victims[key];
  save();
  return { total: data.total, userCount: data.victims[key] || 0 };
}

export function getVictimList(): { name: string; count: number }[] {
  const data = load();
  return Object.entries(data.victims)
    .map(([name, count]) => ({ name, count }))
    .filter(v => v.count > 0)
    .sort((a, b) => b.count - a.count);
}

export function isBlacklisted(target: string): boolean {
  return load().blacklist.includes(target.toLowerCase());
}

export function addToBlacklist(target: string): boolean {
  const data = load();
  const key = target.toLowerCase();
  if (data.blacklist.includes(key)) return false;
  data.blacklist.push(key);
  save();
  return true;
}

export function removeFromBlacklist(target: string): boolean {
  const data = load();
  const key = target.toLowerCase();
  const idx = data.blacklist.indexOf(key);
  if (idx < 0) return false;
  data.blacklist.splice(idx, 1);
  save();
  return true;
}

/**
 * Migrate bic data from a tenant's automation-variables.json into the global bic store.
 * Merges counts — won't overwrite existing data, only adds to it.
 */
export async function migrateFromAutomationVariables(tenantId?: string): Promise<number> {
  try {
    const { readAutomationVariables } = await import('@/lib/automation-variables-store');
    const allVars = await readAutomationVariables(tenantId);
    const oldTotal = Number(allVars.global?.bic_total) || 0;
    const oldBlacklist = (allVars.global?.bic_blacklist as string[] | undefined) || [];

    if (oldTotal === 0) return 0;

    const data = load();
    let migrated = 0;

    for (const [name, vars] of Object.entries(allVars.users || {})) {
      const count = Number((vars as any).bic_user_count) || 0;
      if (count <= 0) continue;
      const key = name.toLowerCase();
      if (!data.victims[key]) {
        data.victims[key] = count;
        migrated += count;
      }
    }

    // Use the higher total (in case some victims were removed)
    if (migrated > 0) {
      data.total = Math.max(data.total, oldTotal);
    }

    // Merge blacklist
    for (const bl of oldBlacklist) {
      const key = bl.toLowerCase();
      if (!data.blacklist.includes(key)) data.blacklist.push(key);
    }

    if (migrated > 0) {
      save();
      console.log(`[Bic] Migrated ${migrated} lighter counts from tenant ${tenantId || 'global'} automation variables`);
    }
    return migrated;
  } catch (err) {
    console.error('[Bic] Migration failed:', err);
    return 0;
  }
}
