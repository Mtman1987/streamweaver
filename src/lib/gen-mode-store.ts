import { promises as fs } from 'fs';
import { resolve } from 'path';
import { tenantPath } from '@/lib/tenant';

export type GenMode = 'eden' | 'seaart' | 'perchance';

function filePath(tenantId?: string): string {
  if (tenantId) return tenantPath(tenantId, 'data/gen-mode.json');
  return resolve(process.cwd(), 'data', 'gen-mode.json');
}

export async function getGenMode(tenantId?: string): Promise<GenMode> {
  try {
    const raw = await fs.readFile(filePath(tenantId), 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed?.mode === 'seaart') return 'seaart';
    if (parsed?.mode === 'perchance') return 'perchance';
    return 'eden';
  } catch {
    return 'eden';
  }
}

export async function setGenMode(mode: GenMode, tenantId?: string): Promise<GenMode> {
  const fp = filePath(tenantId);
  await fs.mkdir(resolve(fp, '..'), { recursive: true });
  await fs.writeFile(fp, JSON.stringify({ mode }, null, 2), 'utf-8');
  return mode;
}

export async function toggleGenMode(tenantId?: string): Promise<GenMode> {
  const current = await getGenMode(tenantId);
  if (current === 'eden') return setGenMode('seaart', tenantId);
  if (current === 'seaart') return setGenMode('perchance', tenantId);
  return setGenMode('eden', tenantId);
}
