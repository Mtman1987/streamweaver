/**
 * Seed script: writes Discord runtime config and baseline bot identity into the owner tenant volume.
 *
 * Usage:
 *   npx tsx scripts/seed-tenant-discord.ts
 *
 * This ensures the deployed Fly.io volume has the correct Discord config so
 * resolveGuildTenant() can map Discord messages to the owner tenant. Existing
 * tenant bot settings always win; this script must never overwrite Athena's
 * saved/canonical personality.
 */

import { promises as fs } from 'fs';
import path from 'path';

const PERSIST_ROOT = process.env.PERSIST_ROOT || path.resolve(process.cwd(), 'data', 'runtime');
const TENANT_ID = '94371378';

// Discord config — update guildId to your actual Discord server ID
const DISCORD_CHANNELS = {
  logChannelId: '1341946492696526858',
  aiChatChannelId: '',
  shoutoutChannelId: '',
  guildId: '1240832965865635881',
  discordBridgeEnabled: true,
};

// Baseline owner bot identity. Deliberately DO NOT seed AI_BOT_PERSONALITY here.
// Athena's canonical personality is tenant-owned and should be saved through the
// normal bot settings/config path from the final character specification.
const USER_CONFIG = {
  TWITCH_BROADCASTER_USERNAME: 'mtman1987',
  AI_PROVIDER: 'edenai',
  AI_BOT_NAME: 'Athena',
  AI_BOT_ALIASES: 'athena,hey athena,annie,athenabot87',
  TTS_PROVIDER: 'openai',
  TTS_VOICE: 'openai:nova',
};

async function seed() {
  const tenantTokensDir = path.join(PERSIST_ROOT, 'tenants', TENANT_ID, 'tokens');
  const tenantConfigDir = path.join(PERSIST_ROOT, 'tenants', TENANT_ID, 'config');
  await fs.mkdir(tenantTokensDir, { recursive: true });
  await fs.mkdir(tenantConfigDir, { recursive: true });

  // Write single-source Discord runtime config
  const discordPath = path.join(tenantConfigDir, 'discord.json');
  await fs.writeFile(discordPath, JSON.stringify(DISCORD_CHANNELS, null, 2));
  console.log(`✅ Written: ${discordPath}`);

  // Write user-config.json, preserving any existing tenant-owned settings.
  const configPath = path.join(tenantTokensDir, 'user-config.json');
  let existing: Record<string, string> = {};
  try {
    existing = JSON.parse(await fs.readFile(configPath, 'utf-8'));
  } catch {}
  const merged = { ...USER_CONFIG, ...existing };
  await fs.writeFile(configPath, JSON.stringify(merged, null, 2));
  console.log(`✅ Written: ${configPath}`);

  console.log('\n🎯 Next steps:');
  console.log('1. Set your Discord guild ID in DISCORD_CHANNELS.guildId above');
  console.log('2. Run: flyctl ssh console -C "node scripts/seed-tenant-discord.js"');
  console.log('3. Existing Athena personality/name/voice settings are preserved');
}

seed().catch(console.error);
