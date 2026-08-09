import * as path from 'path';
import * as fs from 'fs';
import { promises as fsp } from 'fs';
import {
  COMMUNITY_BOT_NAME,
  COMMUNITY_BOT_PERSONALITY,
  isAccidentalAthenaGlobalDefault,
} from './bot-personality-defaults';

// In production (Fly.io), PERSIST_ROOT points to the mounted volume.
// Locally, fall back to the project's own data directory.
const PERSIST_ROOT = process.env.PERSIST_ROOT || path.resolve(process.cwd(), 'data', 'runtime');

// Admin Twitch ID — only this user can connect the community bot
const ADMIN_TWITCH_ID = process.env.ADMIN_TWITCH_ID || process.env.NEXT_PUBLIC_HARDCODED_ADMIN_TWITCH_ID || '94371378';

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
 * Returns the root path for a specific tenant's data folder.
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

export function getAdminTwitchId(): string {
  return ADMIN_TWITCH_ID;
}

// Subdirectories created for each new tenant
const TENANT_SUBDIRS = ['tokens', 'config', 'data', 'actions', 'commands', 'logs'];

/**
 * Bootstrap a new tenant's directory structure on first login.
 * Copies default templates if they exist.
 */
export async function bootstrapTenant(twitchId: string, username: string): Promise<void> {
  const root = tenantRoot(twitchId);
  const tenantCommandsDir = path.join(root, 'commands');
  const tenantActionsDir = path.join(root, 'actions');

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

  // Seed user-config with community bot defaults if missing. Athena is a
  // tenant-owned bot identity and must never be the global/new-tenant default.
  const userConfigPath = path.join(root, 'tokens', 'user-config.json');
  try {
    let userConfig: Record<string, string> = {};
    if (fs.existsSync(userConfigPath)) {
      userConfig = JSON.parse(await fsp.readFile(userConfigPath, 'utf-8'));
    }

    let changed = false;
    const accidentallySeededAthena =
      !isAdmin(twitchId) && isAccidentalAthenaGlobalDefault(userConfig.AI_BOT_PERSONALITY);

    if (!userConfig.AI_BOT_PERSONALITY || accidentallySeededAthena) {
      userConfig.AI_BOT_PERSONALITY = COMMUNITY_BOT_PERSONALITY;
      changed = true;
    }
    if (!userConfig.AI_BOT_NAME || (accidentallySeededAthena && userConfig.AI_BOT_NAME === 'Athena')) {
      userConfig.AI_BOT_NAME = COMMUNITY_BOT_NAME;
      changed = true;
    }
    if (!userConfig.TWITCH_BROADCASTER_USERNAME) {
      userConfig.TWITCH_BROADCASTER_USERNAME = username;
      changed = true;
    }
    if (changed) {
      await fsp.mkdir(path.dirname(userConfigPath), { recursive: true });
      await fsp.writeFile(userConfigPath, JSON.stringify(userConfig, null, 2));
    }
  } catch {}

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

  // Seed default starter packages instead of copying every raw root command/action.
  // This keeps first-run tenants aligned with the curated community library.
  try {
    const existingCommandFiles = fs.existsSync(tenantCommandsDir)
      ? (await fsp.readdir(tenantCommandsDir)).filter((file) => file.endsWith('.json') && file !== '_metadata.json')
      : [];
    const existingActionFiles = fs.existsSync(tenantActionsDir)
      ? (await fsp.readdir(tenantActionsDir)).filter((file) => file.endsWith('.json') && file !== '_metadata.json')
      : [];

    if (existingCommandFiles.length === 0 && existingActionFiles.length === 0) {
      const flowPackages = await import('./flow-packages');
      const published = await flowPackages.listPublishedFlowPackages();
      const starterPackages =
        published.filter(flowPackages.isDefaultStarterFlowPackage).length > 0
          ? published.filter(flowPackages.isDefaultStarterFlowPackage)
          : (await flowPackages.listTenantFlowPackages()).filter(flowPackages.isDefaultStarterFlowPackage);

      for (const pkg of starterPackages) {
        await flowPackages.importFlowPackage(pkg, twitchId);
      }
    }
  } catch (error) {
    console.warn(`[Tenant] Failed to seed starter flow packages for ${twitchId}:`, error);
  }

  // Copy root config files so redeems, OBS, etc. work out of the box
  const rootConfigDir = path.resolve(process.cwd(), 'config');
  const tenantConfigDir = path.join(root, 'config');
  if (fs.existsSync(rootConfigDir)) {
    const files = await fsp.readdir(rootConfigDir);
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const dest = path.join(tenantConfigDir, file);
      if (!fs.existsSync(dest)) {
        await fsp.copyFile(path.join(rootConfigDir, file), dest);
      }
    }
  }

  // Ensure tenant twitch config is aligned with this tenant's identity.
  // Root config templates may contain a different broadcaster username.
  const twitchConfigPath = path.join(tenantConfigDir, 'twitch.json');
  try {
    let twitchConfig: any = {};
    if (fs.existsSync(twitchConfigPath)) {
      twitchConfig = JSON.parse(await fsp.readFile(twitchConfigPath, 'utf-8'));
    }

    let tokenBotUsername = '';
    const tenantTokensPath = path.join(root, 'tokens', 'twitch-tokens.json');
    if (fs.existsSync(tenantTokensPath)) {
      try {
        const tokenData = JSON.parse(await fsp.readFile(tenantTokensPath, 'utf-8'));
        tokenBotUsername = tokenData.botUsername || '';
      } catch {}
    }

    const nextTwitchConfig = {
      ...twitchConfig,
      broadcasterUsername: username,
      botUsername: tokenBotUsername || twitchConfig.botUsername || '',
    };
    await fsp.writeFile(twitchConfigPath, JSON.stringify(nextTwitchConfig, null, 2), 'utf-8');
  } catch (error) {
    console.warn(`[Tenant] Failed to normalize twitch config for ${twitchId}:`, error);
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
  const { parseSessionCookie } = require('./session-cookie');
  return parseSessionCookie(sessionJson)?.id || null;
}

/**
 * Re-bootstrap all existing tenants on startup.
 * Fills in missing directories, config, commands, and actions
 * without overwriting anything that already exists.
 */
export async function rebootstrapAllTenants(): Promise<void> {
  const tenantIds = await listTenants();
  if (tenantIds.length === 0) return;

  console.log(`[Tenant] Re-bootstrapping ${tenantIds.length} tenant(s)...`);
  for (const twitchId of tenantIds) {
    try {
      // Read username from stored tokens
      let username = '';
      const tokensFile = tenantPath(twitchId, 'tokens/twitch-tokens.json');
      try {
        const raw = await fsp.readFile(tokensFile, 'utf-8');
        const tokens = JSON.parse(raw);
        username = tokens.broadcasterUsername || tokens.loginUsername || '';
      } catch {}

      if (!username) {
        console.warn(`[Tenant] Skipping ${twitchId} — no username in tokens`);
        continue;
      }

      await bootstrapTenant(twitchId, username);
      console.log(`[Tenant] ✅ Re-bootstrapped ${twitchId} (${username})`);
    } catch (err) {
      console.error(`[Tenant] Failed to re-bootstrap ${twitchId}:`, err);
    }
  }
}
