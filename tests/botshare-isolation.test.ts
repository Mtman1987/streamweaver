import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('Discord plain-name routing can address any configured tenant bot', async () => {
  const persistRoot = await mkdtemp(path.join(os.tmpdir(), 'streamweaver-botshare-'));
  process.env.PERSIST_ROOT = persistRoot;

  try {
    const writeTenantConfig = async (tenantId: string, botName: string, aliases: string) => {
      const tokensDir = path.join(persistRoot, 'tenants', tenantId, 'tokens');
      const configDir = path.join(persistRoot, 'tenants', tenantId, 'config');
      await mkdir(tokensDir, { recursive: true });
      await mkdir(configDir, { recursive: true });
      await writeFile(path.join(tokensDir, 'user-config.json'), JSON.stringify({
        AI_BOT_NAME: botName,
        AI_BOT_ALIASES: aliases,
      }));
      await writeFile(path.join(configDir, 'discord.json'), JSON.stringify({
        guildId: 'shared-guild',
        discordUserId: `discord-${tenantId}`,
      }));
    };
    await writeTenantConfig('tenant-a', 'LocalBot', 'local pal');
    await writeTenantConfig('tenant-b', 'ForeignBot', 'foreign pal');
    await writeTenantConfig('discord-c', 'DiscordIdBot', 'discord id bot');

    const { resolveDiscordAuthorTenant, resolveMentionedBot } = await import('../src/app/api/discord/chat/route');
    assert.equal((await resolveMentionedBot('hello local pal', 'tenant-a'))?.tenantId, 'tenant-a');
    assert.equal((await resolveMentionedBot('hello foreign pal', 'tenant-a'))?.tenantId, 'tenant-b');
    assert.equal((await resolveMentionedBot('foreignbot tell a joke', 'tenant-a'))?.tenantId, 'tenant-b');
    assert.equal(await resolveDiscordAuthorTenant('discord-tenant-a'), 'tenant-a');
    assert.equal(await resolveDiscordAuthorTenant('discord-tenant-b'), 'tenant-b');
    assert.equal(await resolveDiscordAuthorTenant('discord-c'), 'discord-c');
    assert.equal(await resolveDiscordAuthorTenant('discord-missing'), undefined);
  } finally {
    await rm(persistRoot, { recursive: true, force: true });
  }
});

test('cross-tenant relay requires both tenants to opt in', async () => {
  const persistRoot = await mkdtemp(path.join(os.tmpdir(), 'streamweaver-relay-optin-'));
  process.env.PERSIST_ROOT = persistRoot;

  try {
    const botShare = await import('../src/lib/bot-interactions-store');
    const { isBotRelayAllowed } = await import('../src/services/chat-dispatcher');
    await botShare.setBotShareMode('on', 'tenant-a');
    assert.equal(await isBotRelayAllowed('tenant-a', 'tenant-b'), false);
    await botShare.setBotShareMode('on', 'tenant-b');
    assert.equal(await isBotRelayAllowed('tenant-a', 'tenant-b'), true);
    assert.equal(await isBotRelayAllowed(undefined, 'tenant-b'), false);
  } finally {
    await rm(persistRoot, { recursive: true, force: true });
  }
});
