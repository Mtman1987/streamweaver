import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

test('existing relay target resolver finds Reaper tenant before real live delivery', async () => {
  const persistRoot = await mkdtemp(path.join(os.tmpdir(), 'streamweaver-relay-resolution-'));
  const previousPersistRoot = process.env.PERSIST_ROOT;
  const previousScheduler = process.env.BACKSTAGE_LORE_DISABLE_SCHEDULER;
  process.env.PERSIST_ROOT = persistRoot;
  process.env.BACKSTAGE_LORE_DISABLE_SCHEDULER = 'true';

  try {
    const { writeUserConfig } = await import('../src/lib/user-config');
    const { reloadBotSettings } = await import('../src/lib/bot-settings-store');
    const { setBotShareMode } = await import('../src/lib/bot-interactions-store');

    await writeUserConfig({
      AI_BOT_NAME: 'Athena',
      AI_BOT_ALIASES: 'Annie,Athenabot87',
      TWITCH_BROADCASTER_USERNAME: 'commander',
    }, 'tenant-athena');
    await writeUserConfig({
      AI_BOT_NAME: 'Reaper',
      AI_BOT_ALIASES: 'The Reaper',
      TWITCH_BROADCASTER_USERNAME: 'nephalem2',
    }, 'tenant-reaper');
    reloadBotSettings('tenant-athena');
    reloadBotSettings('tenant-reaper');
    await setBotShareMode('off', 'tenant-athena');
    await setBotShareMode('off', 'tenant-reaper');

    const { resolveRelayTarget } = await import('../src/services/chat-dispatcher');
    const { deliverExplicitBotRelay } = await import('../src/services/explicit-bot-relay');

    const resolved = await resolveRelayTarget({ namedTarget: 'Reaper' });
    assert.ok(resolved);
    assert.equal(resolved?.tenantId, 'tenant-reaper');
    assert.equal(resolved?.character.currentName, 'Reaper');

    const sent: Array<{ message: string; channel?: string; tenantId?: string }> = [];
    const result = await deliverExplicitBotRelay({
      sourceTenantId: 'tenant-athena',
      sourceUserName: 'Commander',
      speaker: {
        stableId: '94371378:athena',
        currentName: 'Athena',
      },
      targetTenantId: resolved!.tenantId!,
      target: resolved!.character,
      relayMessage: 'let Neph know the Commander will be ready to play in 10 minutes',
    }, {
      getBroadcasterChannel: async (tenantId) => {
        assert.equal(tenantId, 'tenant-reaper');
        return 'nephalem2';
      },
      lookupLiveTarget: async (channel) => {
        assert.equal(channel, 'nephalem2');
        return { isLive: true };
      },
      generateRelayText: async () => 'Hey boss, Athena wanted me to let you know the Commander will be ready in 10 minutes to play.',
      sendTwitch: async (message, _as, channel, tenantId) => {
        sent.push({ message, channel, tenantId });
      },
    });

    assert.equal(result.delivered, true);
    assert.equal(result.mode, 'live');
    assert.deepEqual(sent, [{
      message: 'Hey boss, Athena wanted me to let you know the Commander will be ready in 10 minutes to play.',
      channel: 'nephalem2',
      tenantId: 'tenant-reaper',
    }]);
  } finally {
    restoreEnv('PERSIST_ROOT', previousPersistRoot);
    restoreEnv('BACKSTAGE_LORE_DISABLE_SCHEDULER', previousScheduler);
    await rm(persistRoot, { recursive: true, force: true });
  }
});
