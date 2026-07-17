import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('loose Discord aliases stay local and foreign bots require explicit addressing', async () => {
  const persistRoot = await mkdtemp(path.join(os.tmpdir(), 'streamweaver-botshare-'));
  process.env.PERSIST_ROOT = persistRoot;

  try {
    const writeTenantConfig = async (tenantId: string, botName: string, aliases: string) => {
      const tokensDir = path.join(persistRoot, 'tenants', tenantId, 'tokens');
      await mkdir(tokensDir, { recursive: true });
      await writeFile(path.join(tokensDir, 'user-config.json'), JSON.stringify({
        AI_BOT_NAME: botName,
        AI_BOT_ALIASES: aliases,
      }));
    };
    await writeTenantConfig('tenant-a', 'LocalBot', 'local pal');
    await writeTenantConfig('tenant-b', 'ForeignBot', 'foreign pal');

    const { resolveMentionedBot } = await import('../src/app/api/discord/chat/route');
    assert.equal((await resolveMentionedBot('hello local pal', 'tenant-a'))?.tenantId, 'tenant-a');
    assert.equal(await resolveMentionedBot('hello foreign pal', 'tenant-a'), null);
    assert.equal((await resolveMentionedBot('hello @foreignbot', 'tenant-a'))?.tenantId, 'tenant-b');
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
