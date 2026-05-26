import { readJsonFile, writeJsonFile, type StorageContext } from './storage';

const ATHENA_WHITELIST_FILE = 'athena-whitelist.json';
export const ATHENA_WHITELIST_TENANT_ID = '94371378';

function toCtx(tenantId?: string): StorageContext | undefined {
  if (!tenantId) return undefined;
  return { tenantId, username: '' };
}

function normalizeUsername(username: string): string {
  return username.trim().toLowerCase().replace(/^@/, '');
}

async function readWhitelist(tenantId?: string): Promise<Set<string>> {
  const data = await readJsonFile<{ users: string[] }>(ATHENA_WHITELIST_FILE, { users: [] }, toCtx(tenantId));
  const users = Array.isArray(data.users) ? data.users : [];
  return new Set(users.map(normalizeUsername).filter(Boolean));
}

export async function getAthenaWhitelist(tenantId?: string): Promise<string[]> {
  return Array.from(await readWhitelist(tenantId)).sort();
}

export async function addAthenaWhitelistUser(username: string, tenantId?: string): Promise<void> {
  const users = await readWhitelist(tenantId);
  const normalized = normalizeUsername(username);
  if (!normalized) return;
  users.add(normalized);
  await writeJsonFile(ATHENA_WHITELIST_FILE, { users: Array.from(users).sort() }, toCtx(tenantId));
}

export async function removeAthenaWhitelistUser(username: string, tenantId?: string): Promise<void> {
  const users = await readWhitelist(tenantId);
  users.delete(normalizeUsername(username));
  await writeJsonFile(ATHENA_WHITELIST_FILE, { users: Array.from(users).sort() }, toCtx(tenantId));
}

export async function canUseAthenaEverywhere(input: {
  username: string;
  tenantId?: string;
}): Promise<boolean> {
  const username = normalizeUsername(input.username);
  if (!username) return false;
  if (username === 'mtman1987') return true;
  return (await readWhitelist(input.tenantId)).has(username);
}
