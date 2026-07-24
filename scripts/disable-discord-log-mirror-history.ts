import { promises as fs } from 'fs';
import path from 'path';

const persistRoot = process.env.PERSIST_ROOT || path.resolve(process.cwd(), 'data', 'runtime');
const tenantsRoot = path.join(persistRoot, 'tenants');

async function fileExists(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

async function main() {
  const results: Array<{
    tenantId: string;
    before: { logChannelId: string; discordBridgeEnabled: boolean };
    after: { logChannelId: string; discordBridgeEnabled: boolean };
  }> = [];

  const tenantIds = (await fs.readdir(tenantsRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  for (const tenantId of tenantIds) {
    const configPath = path.join(tenantsRoot, tenantId, 'config', 'discord.json');
    if (!(await fileExists(configPath))) continue;

    const config = JSON.parse(await fs.readFile(configPath, 'utf-8'));
    const before = {
      logChannelId: String(config.logChannelId || ''),
      discordBridgeEnabled: config.discordBridgeEnabled !== false,
    };

    config.logChannelId = '';
    config.discordBridgeEnabled = false;

    await fs.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf-8');
    results.push({
      tenantId,
      before,
      after: { logChannelId: '', discordBridgeEnabled: false },
    });
  }

  console.log(JSON.stringify({
    persistRoot,
    changed: results.length,
    results,
  }, null, 2));
}

main().catch((error) => {
  console.error('[DisableDiscordLogMirrorHistory] Failed:', error);
  process.exitCode = 1;
});
