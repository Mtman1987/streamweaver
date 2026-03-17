import * as fs from 'fs/promises';
import { resolve } from 'path';

export type AutomationVariablesData = {
  global: Record<string, unknown>;
  users: Record<string, Record<string, unknown>>;
};

const VARIABLES_FILE_PATH = resolve(process.cwd(), 'tokens', 'automation-variables.json');

let cached: AutomationVariablesData | null = null;

async function ensureTokensDirExists(): Promise<void> {
  const dir = resolve(process.cwd(), 'tokens');
  await fs.mkdir(dir, { recursive: true });
}

function normalizeUserKey(user: string): string {
  return user.trim();
}

function emptyData(): AutomationVariablesData {
  return { global: {}, users: {} };
}

export async function readAutomationVariables(): Promise<AutomationVariablesData> {
  if (cached) return cached;
  try {
    const raw = await fs.readFile(VARIABLES_FILE_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      cached = emptyData();
      return cached;
    }
    cached = {
      global: typeof parsed.global === 'object' && parsed.global ? parsed.global : {},
      users: typeof parsed.users === 'object' && parsed.users ? parsed.users : {},
    } as AutomationVariablesData;
    return cached;
  } catch (error: any) {
    if (error?.code === 'ENOENT') {
      cached = emptyData();
      return cached;
    }
    throw error;
  }
}

export async function replaceAutomationVariables(next: AutomationVariablesData): Promise<void> {
  await writeAutomationVariables(next);
}

async function writeAutomationVariables(next: AutomationVariablesData): Promise<void> {
  await ensureTokensDirExists();
  cached = next;
  await fs.writeFile(VARIABLES_FILE_PATH, JSON.stringify(next, null, 2), 'utf-8');
}

export async function listGlobalVariables(): Promise<Record<string, unknown>> {
  const data = await readAutomationVariables();
  return { ...data.global };
}

export async function replaceGlobalVariables(nextGlobal: Record<string, unknown>): Promise<void> {
  const data = await readAutomationVariables();
  await writeAutomationVariables({ ...data, global: { ...nextGlobal } });
}

export async function setGlobalVariable(key: string, value: unknown): Promise<void> {
  const data = await readAutomationVariables();
  const next: AutomationVariablesData = {
    ...data,
    global: { ...data.global, [key]: value },
  };
  await writeAutomationVariables(next);
}

export async function deleteGlobalVariable(key: string): Promise<void> {
  const data = await readAutomationVariables();
  const nextGlobal = { ...data.global };
  delete nextGlobal[key];
  await writeAutomationVariables({ ...data, global: nextGlobal });
}

export async function listUserVariables(user: string): Promise<Record<string, unknown>> {
  const data = await readAutomationVariables();
  const userKey = normalizeUserKey(user);
  return { ...(data.users[userKey] || {}) };
}

export async function replaceUserVariables(user: string, nextUser: Record<string, unknown>): Promise<void> {
  const data = await readAutomationVariables();
  const userKey = normalizeUserKey(user);
  await writeAutomationVariables({
    ...data,
    users: { ...data.users, [userKey]: { ...nextUser } },
  });
}

export async function setUserVariable(user: string, key: string, value: unknown): Promise<void> {
  const data = await readAutomationVariables();
  const userKey = normalizeUserKey(user);
  const currentUser = data.users[userKey] || {};
  await writeAutomationVariables({
    ...data,
    users: { ...data.users, [userKey]: { ...currentUser, [key]: value } },
  });
}

export async function deleteUserVariable(user: string, key: string): Promise<void> {
  const data = await readAutomationVariables();
  const userKey = normalizeUserKey(user);
  const currentUser = { ...(data.users[userKey] || {}) };
  delete currentUser[key];
  await writeAutomationVariables({
    ...data,
    users: { ...data.users, [userKey]: currentUser },
  });
}
