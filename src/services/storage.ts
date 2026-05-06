import { promises as fs } from 'fs';
import path from 'path';
import { tenantPath } from '@/lib/tenant';
import { readUserConfigSync } from '@/lib/user-config';

export interface StorageContext {
  tenantId: string;
  username: string;
}

// Legacy fallback: reads from the old single-user data dir
function getLegacyDataRoot(): string {
  const config = readUserConfigSync();
  const username = config.TWITCH_BROADCASTER_USERNAME || 'default';
  return path.resolve(process.cwd(), 'data', username);
}

function resolveDataRoot(ctx?: StorageContext): string {
  if (ctx?.tenantId) {
    return path.join(tenantPath(ctx.tenantId, 'data'), ctx.username);
  }
  return getLegacyDataRoot();
}

// Mutex for file writing to prevent race conditions
const fileLocks: Map<string, Promise<void>> = new Map();

async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true });
}

async function acquireLock(key: string): Promise<() => void> {
  while (fileLocks.has(key)) {
    await fileLocks.get(key);
  }
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  fileLocks.set(key, promise);
  return release;
}

function releaseLock(key: string, release: () => void): void {
  fileLocks.delete(key);
  release();
}

export async function readJsonFile<T = any>(fileName: string, defaultValue: T, ctx?: StorageContext): Promise<T> {
  const dataRoot = resolveDataRoot(ctx);
  await ensureDir(dataRoot);
  const filePath = path.join(dataRoot, fileName);
  try {
    const data = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(data) as T;
  } catch (error: any) {
    if (error.code === 'ENOENT') return defaultValue;
    throw error;
  }
}

export async function writeJsonFile(fileName: string, data: any, ctx?: StorageContext): Promise<void> {
  const dataRoot = resolveDataRoot(ctx);
  await ensureDir(dataRoot);
  const filePath = path.join(dataRoot, fileName);

  const release = await acquireLock(filePath);
  const tempPath = `${filePath}.tmp.${Date.now()}`;
  try {
    await fs.writeFile(tempPath, JSON.stringify(data, null, 2), 'utf-8');
    await fs.rename(tempPath, filePath);
  } catch (error) {
    try { await fs.unlink(tempPath); } catch {}
    throw error;
  } finally {
    releaseLock(filePath, release);
  }
}
