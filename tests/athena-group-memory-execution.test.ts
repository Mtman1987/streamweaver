import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

test('explicit tell-a-bot request selects a real relay even when visible botshare is off', async () => {
  const persistRoot = await mkdtemp(path.join(os.tmpdir(), 'streamweaver-athena-relay-intent-'));
  const previousPersistRoot = process.env.PERSIST_ROOT;
  const previousScheduler = process.env.BACKSTAGE_LORE_DISABLE_SCHEDULER;
  process.env.PERSIST_ROOT = persistRoot;
  process.env.BACKSTAGE_LORE_DISABLE_SCHEDULER = 'true';

  try {
    const { writeUserConfig } = await import('../src/lib/user-config');
    const { reloadBotSettings } = await import('../src/lib/bot-settings-store');
    const { setBotShareMode } = await import('../src/lib/bot-interactions-store');
    const { decideAthenaAction } = await import('../src/services/athena-tools');

    await writeUserConfig({
      AI_BOT_NAME: 'Athena',
      AI_BOT_ALIASES: 'Annie,Athenabot87',
      AI_BOT_PERSONALITY: 'Responsible archive steward.',
      TWITCH_BROADCASTER_USERNAME: 'commander',
    }, 'tenant-athena');
    reloadBotSettings('tenant-athena');
    await setBotShareMode('off', 'tenant-athena');

    const decision = await decideAthenaAction({
      tenantId: 'tenant-athena',
      message: 'Athena, tell Reaper to let Neph know the Commander will be ready to play in 10 minutes.',
      actor: { username: 'commander', displayName: 'Commander', isOwner: true },
      location: {
        app: 'streamweaver',
        surface: 'discord-dm',
        channelId: 'private-dm',
        live: false,
        replyMode: 'structured',
      },
      visibility: 'private',
      executeTools: true,
    });

    assert.equal(decision.mode, 'tool');
    assert.equal(decision.toolId, 'bot.relay');
    assert.equal(decision.arguments?.targetName, 'Reaper');
    assert.match(String(decision.arguments?.relayMessage || ''), /Neph/i);
    assert.match(String(decision.arguments?.relayMessage || ''), /10 minutes/i);
  } finally {
    restoreEnv('PERSIST_ROOT', previousPersistRoot);
    restoreEnv('BACKSTAGE_LORE_DISABLE_SCHEDULER', previousScheduler);
    await rm(persistRoot, { recursive: true, force: true });
  }
});
