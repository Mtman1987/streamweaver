import * as fs from 'fs/promises';
import { resolve } from 'path';
import { tenantPath } from './tenant';

export type AutomationVariablesData = {
  global: Record<string, unknown>;
  users: Record<string, Record<string, unknown>>;
};

function variablesFilePath(tenantId?: string): string {
  if (tenantId) {
    return tenantPath(tenantId, 'tokens/automation-variables.json');
  }
  return resolve(process.cwd(), 'tokens', 'automation-variables.json');
}

const cached = new Map<string, AutomationVariablesData>();

function cacheKey(tenantId?: string): string {
  return tenantId || '__global__';
}

async function ensureTokensDirExists(tenantId?: string): Promise<void> {
  const dir = resolve(variablesFilePath(tenantId), '..');
  await fs.mkdir(dir, { recursive: true });
}

function normalizeUserKey(user: string): string {
  return user.trim();
}

function emptyData(): AutomationVariablesData {
  return { global: {}, users: {} };
}

export async function readAutomationVariables(tenantId?: string): Promise<AutomationVariablesData> {
  const key = cacheKey(tenantId);
  const existing = cached.get(key);
  if (existing) return existing;
  try {
    const raw = await fs.readFile(variablesFilePath(tenantId), 'utf-8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      const empty = emptyData();
      cached.set(key, empty);
      return empty;
    }
    const next = {
      global: typeof parsed.global === 'object' && parsed.global ? parsed.global : {},
      users: typeof parsed.users === 'object' && parsed.users ? parsed.users : {},
    } as AutomationVariablesData;
    cached.set(key, next);
    return next;
  } catch (error: any) {
    if (error?.code === 'ENOENT') {
      const empty = emptyData();
      cached.set(key, empty);
      return empty;
    }
    throw error;
  }
}

export async function replaceAutomationVariables(next: AutomationVariablesData, tenantId?: string): Promise<void> {
  await writeAutomationVariables(next, tenantId);
}

async function writeAutomationVariables(next: AutomationVariablesData, tenantId?: string): Promise<void> {
  await ensureTokensDirExists(tenantId);
  cached.set(cacheKey(tenantId), next);
  await fs.writeFile(variablesFilePath(tenantId), JSON.stringify(next, null, 2), 'utf-8');
}

export async function listGlobalVariables(tenantId?: string): Promise<Record<string, unknown>> {
  const data = await readAutomationVariables(tenantId);
  return { ...data.global };
}

export async function replaceGlobalVariables(nextGlobal: Record<string, unknown>, tenantId?: string): Promise<void> {
  const data = await readAutomationVariables(tenantId);
  await writeAutomationVariables({ ...data, global: { ...nextGlobal } }, tenantId);
}

export async function setGlobalVariable(key: string, value: unknown, tenantId?: string): Promise<void> {
  const data = await readAutomationVariables(tenantId);
  const next: AutomationVariablesData = {
    ...data,
    global: { ...data.global, [key]: value },
  };
  await writeAutomationVariables(next, tenantId);
}

export async function deleteGlobalVariable(key: string, tenantId?: string): Promise<void> {
  const data = await readAutomationVariables(tenantId);
  const nextGlobal = { ...data.global };
  delete nextGlobal[key];
  await writeAutomationVariables({ ...data, global: nextGlobal }, tenantId);
}

export async function listUserVariables(user: string, tenantId?: string): Promise<Record<string, unknown>> {
  const data = await readAutomationVariables(tenantId);
  const userKey = normalizeUserKey(user);
  return { ...(data.users[userKey] || {}) };
}

export async function replaceUserVariables(user: string, nextUser: Record<string, unknown>, tenantId?: string): Promise<void> {
  const data = await readAutomationVariables(tenantId);
  const userKey = normalizeUserKey(user);
  await writeAutomationVariables({
    ...data,
    users: { ...data.users, [userKey]: { ...nextUser } },
  }, tenantId);
}

export async function setUserVariable(user: string, key: string, value: unknown, tenantId?: string): Promise<void> {
  const data = await readAutomationVariables(tenantId);
  const userKey = normalizeUserKey(user);
  const currentUser = data.users[userKey] || {};
  await writeAutomationVariables({
    ...data,
    users: { ...data.users, [userKey]: { ...currentUser, [key]: value } },
  }, tenantId);
}

export async function deleteUserVariable(user: string, key: string, tenantId?: string): Promise<void> {
  const data = await readAutomationVariables(tenantId);
  const userKey = normalizeUserKey(user);
  const currentUser = { ...(data.users[userKey] || {}) };
  delete currentUser[key];
  await writeAutomationVariables({
    ...data,
    users: { ...data.users, [userKey]: currentUser },
  }, tenantId);
}
