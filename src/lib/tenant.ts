import * as path from 'path';
import * as fs from 'fs';
import { promises as fsp } from 'fs';

// In production (Fly.io), PERSIST_ROOT points to the mounted volume.
// Locally, fall back to the project's own data directory.
const PERSIST_ROOT = process.env.PERSIST_ROOT || path.resolve(process.cwd(), 'data', 'runtime');

// Admin Twitch ID — only this user can connect the community bot
const ADMIN_TWITCH_ID = process.env.ADMIN_TWITCH_ID || '';

/**
 * Returns the root path for data shared across ALL tenants.
 * e.g. pokemon cards, MasterStats, future Space Mountain Coins
 */
export function globalRoot(): string {
  return path.join(PERSIST_ROOT, 'global');
}

/**
 * Returns a file path inside the global shared data folder.
 */
export function globalPath(file: string): string {
  return path.join(globalRoot(), file);
}

/**
 * Returns the root path for a specific tenant's data.
 */
export function tenantRoot(twitchId: string): string {
  if (!twitchId) throw new Error('tenantRoot requires a twitchId');
  return path.join(PERSIST_ROOT, 'tenants', twitchId);
}

/**
 * Returns a file path inside a tenant's data folder.
 */
export function tenantPath(twitchId: string, file: string): string {
  return path.join(tenantRoot(twitchId), file);
}

/**
 * Returns the community bot tokens path (admin-only, global).
 */
export function communityBotTokensPath(): string {
  return globalPath('community-bot-tokens.json');
}

/**
 * Check if a Twitch ID is the admin.
 */
export function isAdmin(twitchId: string): boolean {
  return Boolean(ADMIN_TWITCH_ID && twitchId === ADMIN_TWITCH_ID);
}

// Subdirectories created for each new tenant
const TENANT_SUBDIRS = ['tokens', 'config', 'data', 'actions', 'commands', 'logs'];

/**
 * Bootstrap a new tenant's directory structure on first login.
 * Copies default templates if they exist.
 */
export async function bootstrapTenant(twitchId: string, username: string): Promise<void> {
  const root = tenantRoot(twitchId);

  // Create all subdirectories
  for (const dir of TENANT_SUBDIRS) {
    await fsp.mkdir(path.join(root, dir), { recursive: true });
  }

  // Create per-username data dir inside tenant
  await fsp.mkdir(path.join(root, 'data', username), { recursive: true });

  // Seed empty data files so debug/live-files pages don't error
  const emptyFiles: Record<string, string> = {
    'data/private-chat.json': '[]',
    [`data/${username}/points.json`]: '{}',
    [`data/${username}/point-settings.json`]: '{}',
    [`data/${username}/channel-point-rewards.json`]: '[]',
  };
  for (const [file, content] of Object.entries(emptyFiles)) {
    const dest = path.join(root, file);
    if (!fs.existsSync(dest)) {
      await fsp.writeFile(dest, content);
    }
  }

  // Seed default files if they don't exist
  const defaultsDir = path.resolve(process.cwd(), 'data', 'default');
  if (fs.existsSync(defaultsDir)) {
    const files = await fsp.readdir(defaultsDir);
    for (const file of files) {
      const dest = path.join(root, 'data', username, file);
      if (!fs.existsSync(dest)) {
        await fsp.copyFile(path.join(defaultsDir, file), dest);
      }
    }
  }

  // Ensure global directories exist too
  await fsp.mkdir(globalPath('pokemon-users'), { recursive: true });
  await fsp.mkdir(globalPath('pokemon-collections'), { recursive: true });
  await fsp.mkdir(globalPath('MasterStats'), { recursive: true });
}

/**
 * List all tenant IDs that have been bootstrapped.
 */
export async function listTenants(): Promise<string[]> {
  const tenantsDir = path.join(PERSIST_ROOT, 'tenants');
  try {
    return await fsp.readdir(tenantsDir);
  } catch {
    return [];
  }
}

/**
 * Extract tenant ID from the streamweaver-session cookie value.
 */
export function getTenantIdFromSession(sessionJson: string | undefined): string | null {
  if (!sessionJson) return null;
  try {
    const session = JSON.parse(sessionJson);
    return session.id || null;
  } catch {
    return null;
  }
}
