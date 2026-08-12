import { promises as fs } from 'fs';
import { resolve } from 'path';
import { tenantPath } from '@/lib/tenant';
import { writeGenerationSettings } from '@/lib/gen-settings-store';

export type GenMode = 'cloudflare' | 'eden' | 'seaart' | 'perchance' | 'pollinations';

function filePath(tenantId?: string): string {
  if (tenantId) return tenantPath(tenantId, 'data/gen-mode.json');
  return resolve(process.cwd(), 'data', 'gen-mode.json');
}

export async function getGenMode(tenantId?: string): Promise<GenMode> {
  try {
    const raw = await fs.readFile(filePath(tenantId), 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed?.mode === 'cloudflare') return 'cloudflare';
    if (parsed?.mode === 'seaart') return 'seaart';
    if (parsed?.mode === 'perchance') return 'perchance';
    if (parsed?.mode === 'pollinations') return 'pollinations';
    if (parsed?.mode === 'eden') return 'eden';
    return 'cloudflare';
  } catch {
    return 'cloudflare';
  }
}

export async function setGenMode(mode: GenMode, tenantId?: string): Promise<GenMode> {
  const fp = filePath(tenantId);
  await fs.mkdir(resolve(fp, '..'), { recursive: true });
  await fs.writeFile(fp, JSON.stringify({ mode }, null, 2), 'utf-8');
  await writeGenerationSettings({ mode }, tenantId).catch(() => {});
  return mode;
}

export async function toggleGenMode(tenantId?: string): Promise<GenMode> {
  const current = await getGenMode(tenantId);
  if (current === 'cloudflare') return setGenMode('eden', tenantId);
  if (current === 'eden') return setGenMode('seaart', tenantId);
  if (current === 'seaart') return setGenMode('pollinations', tenantId);
  if (current === 'pollinations') return setGenMode('perchance', tenantId);
  return setGenMode('cloudflare', tenantId);
}
