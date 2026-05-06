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

  // Seed user-config with bot personality if missing
  const userConfigPath = path.join(root, 'tokens', 'user-config.json');
  try {
    let userConfig: Record<string, string> = {};
    if (fs.existsSync(userConfigPath)) {
      userConfig = JSON.parse(await fsp.readFile(userConfigPath, 'utf-8'));
    }
    let changed = false;
    if (!userConfig.AI_BOT_PERSONALITY) {
      userConfig.AI_BOT_PERSONALITY = `You are StreamWeaver87, the onboard AI steward of the Space Mountain — a legendary interstellar cruise liner that drifts between streams. You're friendly, slightly theatrical, and obsessed with keeping passengers (chat) entertained. You speak with the flair of a theme park ride narrator mixed with a helpful concierge. Keep responses to 1-2 sentences. Address viewers as "passengers" and the streamer as "Captain."`;
      changed = true;
    }
    if (!userConfig.AI_BOT_NAME) {
      userConfig.AI_BOT_NAME = 'StreamWeaver87';
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

  // Copy root commands as starter set for new tenant
  const rootCommandsDir = path.resolve(process.cwd(), 'commands');
  const tenantCommandsDir = path.join(root, 'commands');
  if (fs.existsSync(rootCommandsDir)) {
    const files = await fsp.readdir(rootCommandsDir);
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const dest = path.join(tenantCommandsDir, file);
      if (!fs.existsSync(dest)) {
        await fsp.copyFile(path.join(rootCommandsDir, file), dest);
      }
    }
  }

  // Copy root actions as starter set for new tenant
  const rootActionsDir = path.resolve(process.cwd(), 'actions');
  const tenantActionsDir = path.join(root, 'actions');
  if (fs.existsSync(rootActionsDir)) {
    const files = await fsp.readdir(rootActionsDir);
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const dest = path.join(tenantActionsDir, file);
      if (!fs.existsSync(dest)) {
        await fsp.copyFile(path.join(rootActionsDir, file), dest);
      }
    }
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
  if (!sessionJson) return null;
  try {
    const session = JSON.parse(sessionJson);
    return session.id || null;
  } catch {
    return null;
  }
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
