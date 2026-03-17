import { promises as fsp } from 'fs';
import path from 'path';

type VaultData = Record<string, unknown>;

const TOKENS_DIR = path.resolve(process.cwd(), 'tokens');
const VAULT_FILE = path.resolve(TOKENS_DIR, 'vault.json');

async function ensureTokensDir(): Promise<void> {
  await fsp.mkdir(TOKENS_DIR, { recursive: true });
}

async function writeVaultAtomic(data: VaultData): Promise<void> {
  await ensureTokensDir();
  const tmpFile = `${VAULT_FILE}.tmp.${process.pid}.${Date.now()}`;
  await fsp.writeFile(tmpFile, JSON.stringify(data, null, 2), 'utf-8');
  await fsp.rename(tmpFile, VAULT_FILE);
}

export async function readVault(): Promise<VaultData> {
  try {
    const raw = await fsp.readFile(VAULT_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as VaultData;
  } catch (error: any) {
    if (error?.code === 'ENOENT') return {};
    throw error;
  }
}

export async function writeVault(next: VaultData): Promise<void> {
  if (!next || typeof next !== 'object' || Array.isArray(next)) {
    throw new Error('Vault payload must be an object');
  }
  await writeVaultAtomic(next);
}

export async function updateVault(patch: Record<string, unknown>): Promise<VaultData> {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new Error('Vault patch must be an object');
  }
  const current = await readVault();
  const next = { ...current, ...patch };
  await writeVault(next);
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