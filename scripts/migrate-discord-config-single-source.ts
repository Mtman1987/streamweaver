import { promises as fs } from 'fs';
import path from 'path';

type JsonObject = Record<string, any>;

const persistRoot = process.env.PERSIST_ROOT || path.resolve(process.cwd(), 'data', 'runtime');
const tenantsRoot = path.join(persistRoot, 'tenants');
const apply = process.argv.includes('--apply');
const deleteLegacy = apply && !process.argv.includes('--keep-legacy');
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

const discordFields = [
  'guildId',
  'logChannelId',
  'aiChatChannelId',
  'shoutoutChannelId',
  'shareChannelId',
  'metricsChannelId',
  'dmChannelId',
  'dmEnabled',
  'dmChannelUpdatedAt',
  'discordBridgeEnabled',
  'discordUserId',
  'discordUsername',
  'discordUserLinkedAt',
];

async function readJson(filePath: string): Promise<JsonObject> {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf-8'));
  } catch {
    return {};
  }
}

function hasValue(value: any): boolean {
  return value !== undefined && value !== null && value !== '';
}

function mergeDiscordConfig(config: JsonObject, legacy: JsonObject): { merged: JsonObject; conflicts: JsonObject } {
  const merged: JsonObject = { ...config };
  const conflicts: JsonObject = {};

  for (const field of discordFields) {
    const legacyValue = legacy[field];
    const configValue = config[field];
    if (!hasValue(configValue) && hasValue(legacyValue)) {
      merged[field] = legacyValue;
      continue;
    }
    if (hasValue(configValue) && hasValue(legacyValue) && JSON.stringify(configValue) !== JSON.stringify(legacyValue)) {
      conflicts[field] = { kept: configValue, legacy: legacyValue };
    }
  }

  if (merged.discordBridgeEnabled === undefined) merged.discordBridgeEnabled = true;
  if (merged.dmEnabled === undefined) merged.dmEnabled = false;
  return { merged, conflicts };
}

async function writeJson(filePath: string, value: JsonObject): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

async function migrateTenant(tenantId: string): Promise<JsonObject> {
  const tenantRoot = path.join(tenantsRoot, tenantId);
  const configPath = path.join(tenantRoot, 'config', 'discord.json');
  const legacyPath = path.join(tenantRoot, 'tokens', 'discord-channels.json');
  const backupPath = path.join(tenantRoot, 'config', '_migration-backups', `discord-channels.${timestamp}.json`);
  const legacyExists = await fileExists(legacyPath);
  const configExists = await fileExists(configPath);
  const config = await readJson(configPath);
  const legacy = await readJson(legacyPath);
  const { merged, conflicts } = mergeDiscordConfig(config, legacy);
  const changed = JSON.stringify(config) !== JSON.stringify(merged);

  if (apply && (changed || !configExists)) {
    await writeJson(configPath, merged);
  }

  if (apply && deleteLegacy && legacyExists) {
    await writeJson(backupPath, legacy);
    await fs.unlink(legacyPath);
  }

  return {
    tenantId,
    configPath,
    legacyPath,
    legacyExists,
    configExists,
    changed,
    legacyDeleted: Boolean(apply && deleteLegacy && legacyExists),
    backupPath: apply && deleteLegacy && legacyExists ? backupPath : undefined,
    conflicts,
  };
}

async function main() {
  let tenantIds: string[] = [];
  try {
    tenantIds = (await fs.readdir(tenantsRoot, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch {
    console.error(`[DiscordConfigMigration] No tenants directory found at ${tenantsRoot}`);
    process.exitCode = 1;
    return;
  }

  const results = [];
  for (const tenantId of tenantIds) {
    results.push(await migrateTenant(tenantId));
  }

  console.log(JSON.stringify({
    mode: apply ? 'apply' : 'dry-run',
    persistRoot,
    tenants: results.length,
    changed: results.filter((result) => result.changed).length,
    legacyDeleted: results.filter((result) => result.legacyDeleted).length,
    conflicts: results.filter((result) => Object.keys(result.conflicts).length > 0),
    results,
  }, null, 2));

  if (!apply) {
    console.log('[DiscordConfigMigration] Dry run only. Re-run with --apply to write config/discord.json, back up legacy files, and delete tokens/discord-channels.json.');
  }
}

main().catch((error) => {
  console.error('[DiscordConfigMigration] Failed:', error);
  process.exitCode = 1;
});
