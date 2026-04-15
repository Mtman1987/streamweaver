import fs from 'fs';
import { promises as fsp } from 'fs';
import path from 'path';
import crypto from 'crypto';
import { tenantPath } from './tenant';

export type UserConfig = Record<string, string>;

const TOKENS_DIR = path.join(process.cwd(), 'tokens');
const USER_CONFIG_PATH = path.join(TOKENS_DIR, 'user-config.json');

function configPath(tenantId?: string): string {
  if (tenantId) {
    return tenantPath(tenantId, 'tokens/user-config.json');
  }
  return USER_CONFIG_PATH;
}

async function writeJsonAtomic(filePath: string, data: unknown): Promise<void> {
  const tempPath = `${filePath}.tmp.${process.pid}.${Date.now()}.${crypto.randomUUID()}`;
  await fsp.writeFile(tempPath, JSON.stringify(data, null, 2), 'utf8');
  await fsp.rename(tempPath, filePath);
}

function normalizeString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function getUserConfigPath(tenantId?: string): string {
  return configPath(tenantId);
}

export function readUserConfigSync(tenantId?: string): Partial<UserConfig> {
  try {
    const p = configPath(tenantId);
    if (!fs.existsSync(p)) return {};
    const raw = fs.readFileSync(p, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};

    const out: Partial<UserConfig> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      const v = normalizeString(value);
      if (v) out[key] = v;
    }
    return out;
  } catch {
    return {};
  }
}

export async function readUserConfig(tenantId?: string): Promise<Partial<UserConfig>> {
  try {
    const raw = await fsp.readFile(configPath(tenantId), 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};

    const out: Partial<UserConfig> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      const v = normalizeString(value);
      if (v) out[key] = v;
    }
    return out;
  } catch {
    return {};
  }
}

export async function writeUserConfig(patch: Record<string, unknown>, tenantId?: string): Promise<Partial<UserConfig>> {
  const existing = await readUserConfig(tenantId);

  const next: Partial<UserConfig> = { ...existing };
  for (const [key, value] of Object.entries(patch)) {
    const v = normalizeString(value);
    if (v) {
      next[key] = v;
    } else {
      delete next[key];
    }
  }

  const dir = path.dirname(configPath(tenantId));
  await fsp.mkdir(dir, { recursive: true });
  await writeJsonAtomic(configPath(tenantId), next);
  return next;
}

export async function isUserConfigComplete(tenantId?: string): Promise<boolean> {
  const cfg = await readUserConfig(tenantId);
  return Boolean(cfg.TWITCH_BROADCASTER_USERNAME);
}

export function applyUserConfigToProcessEnvSync(): void {
  try {
    const cfg = readUserConfigSync();
    for (const [key, value] of Object.entries(cfg)) {
      if (!value) continue;
      if (process.env[key] == null || process.env[key] === '') {
        process.env[key] = value;
      }
    }
  } catch (error) {
    console.warn('Failed to apply user config:', error);
  }
}
