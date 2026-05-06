import { promises as fsp } from 'fs';
import path from 'path';
import { tenantPath } from './tenant';

type VaultData = Record<string, unknown>;

const TOKENS_DIR = path.resolve(process.cwd(), 'tokens');

function vaultFilePath(tenantId?: string): string {
  if (tenantId) {
    return tenantPath(tenantId, 'tokens/vault.json');
  }
  return path.resolve(TOKENS_DIR, 'vault.json');
}

async function ensureTokensDir(tenantId?: string): Promise<void> {
  await fsp.mkdir(path.dirname(vaultFilePath(tenantId)), { recursive: true });
}

async function writeVaultAtomic(data: VaultData, tenantId?: string): Promise<void> {
  const filePath = vaultFilePath(tenantId);
  await ensureTokensDir(tenantId);
  const tmpFile = `${filePath}.tmp.${process.pid}.${Date.now()}`;
  await fsp.writeFile(tmpFile, JSON.stringify(data, null, 2), 'utf-8');
  await fsp.rename(tmpFile, filePath);
}

export async function readVault(tenantId?: string): Promise<VaultData> {
  try {
    const raw = await fsp.readFile(vaultFilePath(tenantId), 'utf-8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as VaultData;
  } catch (error: any) {
    if (error?.code === 'ENOENT') return {};
    throw error;
  }
}

export async function writeVault(next: VaultData, tenantId?: string): Promise<void> {
  if (!next || typeof next !== 'object' || Array.isArray(next)) {
    throw new Error('Vault payload must be an object');
  }
  await writeVaultAtomic(next, tenantId);
}

export async function updateVault(patch: Record<string, unknown>, tenantId?: string): Promise<VaultData> {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new Error('Vault patch must be an object');
  }
  const current = await readVault(tenantId);
  const next = { ...current, ...patch };
  await writeVault(next, tenantId);
  return next;
}

export const vaultStore = {
  get: async (key: string) => {
    const vault = await readVault();
    return vault[key] ?? null;
  },
  set: async (key: string, value: unknown) => {
    const vault = await readVault();
    vault[key] = value;
    await writeVault(vault);
  },
  delete: async (key: string) => {
    const vault = await readVault();
    delete vault[key];
    await writeVault(vault);
  },
};
