/**
 * Seed script: Copies discord-channels.json and user-config.json into the tenant volume.
 * 
 * Usage:
 *   npx tsx scripts/seed-tenant-discord.ts
 * 
 * This ensures the deployed Fly.io volume has the correct discord config
 * so that resolveGuildTenant() can map Discord messages to the right tenant,
 * and getBotName() returns "Athena" instead of the default "StreamWeaver87".
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

// Bot identity config — ensures Athena name is used for AI responses
const USER_CONFIG = {
  TWITCH_BROADCASTER_USERNAME: 'mtman1987',
  AI_PROVIDER: 'edenai',
  AI_BOT_NAME: 'Athena',
  AI_BOT_PERSONALITY: `You are Athena, a witty and warm AI companion for mtman1987's Twitch stream. You're clever, slightly sarcastic but always supportive. Keep responses to 1-2 sentences. You care about the community and love engaging with chat.`,
  AI_BOT_ALIASES: 'athena,hey athena,annie,athenabot87',
  TTS_PROVIDER: 'inworld',
  TTS_VOICE: 'Ashley',
};

async function seed() {
  const tenantTokensDir = path.join(PERSIST_ROOT, 'tenants', TENANT_ID, 'tokens');
  await fs.mkdir(tenantTokensDir, { recursive: true });

  // Write discord-channels.json
  const discordPath = path.join(tenantTokensDir, 'discord-channels.json');
  await fs.writeFile(discordPath, JSON.stringify(DISCORD_CHANNELS, null, 2));
  console.log(`✅ Written: ${discordPath}`);

  // Write user-config.json
  const configPath = path.join(tenantTokensDir, 'user-config.json');
  // Merge with existing if present
  let existing: Record<string, string> = {};
  try {
    existing = JSON.parse(await fs.readFile(configPath, 'utf-8'));
  } catch {}
  const merged = { ...existing, ...USER_CONFIG };
  await fs.writeFile(configPath, JSON.stringify(merged, null, 2));
  console.log(`✅ Written: ${configPath}`);

  console.log('\n🎯 Next steps:');
  console.log('1. Set your Discord guild ID in DISCORD_CHANNELS.guildId above');
  console.log('2. Run: flyctl ssh console -C "node scripts/seed-tenant-discord.js"');
  console.log('   OR deploy and it runs on next restart via postinstall');
  console.log('3. The bot will now respond to "athena" in Discord messages');
}

seed().catch(console.error);
