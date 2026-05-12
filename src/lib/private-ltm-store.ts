import { promises as fs } from 'fs';
import { resolve } from 'path';
import { tenantPath } from '@/lib/tenant';

export interface LTMEntry {
  title: string;
  content: string;
  createdAt: string;
  messageRange?: { from: string; to: string };
}

function getLtmFilePath(tenantId?: string): string {
  if (tenantId) {
    return tenantPath(tenantId, 'data/private-ltm.json');
  }
  return resolve(process.cwd(), 'data', 'runtime', 'global', 'private-ltm.json');
}

function getCounterFilePath(tenantId?: string): string {
  if (tenantId) {
    return tenantPath(tenantId, 'data/private-ltm-counter.json');
  }
  return resolve(process.cwd(), 'data', 'runtime', 'global', 'private-ltm-counter.json');
}

export async function getLTMEntries(tenantId?: string): Promise<LTMEntry[]> {
  try {
    const raw = await fs.readFile(getLtmFilePath(tenantId), 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function saveLTMEntries(entries: LTMEntry[], tenantId?: string): Promise<void> {
  const filePath = getLtmFilePath(tenantId);
  await fs.mkdir(resolve(filePath, '..'), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(entries, null, 2));
}

export async function getPrivateLTMTitles(tenantId?: string): Promise<string[]> {
  const entries = await getLTMEntries(tenantId);
  return entries.map((e) => e.title);
}

export async function retrieveLTMByTitle(title: string, tenantId?: string): Promise<string | null> {
  const entries = await getLTMEntries(tenantId);
  const entry = entries.find((e) => e.title.toLowerCase() === title.toLowerCase());
  return entry?.content || null;
}

export async function addLTMEntry(entry: LTMEntry, tenantId?: string): Promise<void> {
  const entries = await getLTMEntries(tenantId);
  // Replace if same title exists
  const idx = entries.findIndex((e) => e.title.toLowerCase() === entry.title.toLowerCase());
  if (idx >= 0) {
    entries[idx] = entry;
  } else {
    entries.push(entry);
  }
  await saveLTMEntries(entries, tenantId);
}

export async function getPrivateMessageCount(tenantId?: string): Promise<number> {
  try {
    const raw = await fs.readFile(getCounterFilePath(tenantId), 'utf-8');
    return JSON.parse(raw).count || 0;
  } catch {
    return 0;
  }
}

export async function incrementPrivateMessageCount(tenantId?: string): Promise<number> {
  const filePath = getCounterFilePath(tenantId);
  await fs.mkdir(resolve(filePath, '..'), { recursive: true });
  const count = (await getPrivateMessageCount(tenantId)) + 1;
  await fs.writeFile(filePath, JSON.stringify({ count }));
  return count;
}
