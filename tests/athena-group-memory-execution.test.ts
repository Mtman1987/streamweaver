import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

test('private tell-a-bot request resolves the configured target tenant and stores memory without live delivery', async () => {
  const persistRoot = await mkdtemp(path.join(os.tmpdir(), 'streamweaver-athena-group-execution-'));
  const previousPersistRoot = process.env.PERSIST_ROOT;
  process.env.PERSIST_ROOT = persistRoot;

  try {
    const { writeUserConfig } = await import('../src/lib/user-config');
    const { reloadBotSettings } = await import('../src/lib/bot-settings-store');
    const {
      readBotInteractionHistory,
      setBotShareMode,
    } = await import('../src/lib/bot-interactions-store');
    const {
      decideAthenaAction,
      executeAthenaDecision,
    } = await import('../src/services/athena-tools');

    await writeUserConfig({
      AI_BOT_NAME: 'Athena',
      AI_BOT_ALIASES: 'Annie,Athenabot87',
      AI_BOT_PERSONALITY: 'Responsible archive steward.',
      TWITCH_BROADCASTER_USERNAME: 'commander',
    }, 'tenant-athena');
    await writeUserConfig({
      AI_BOT_NAME: 'Reaper',
      AI_BOT_ALIASES: 'The Reaper',
      AI_BOT_PERSONALITY: 'A theatrical abyssal guardian.',
      TWITCH_BROADCASTER_USERNAME: 'reaper-streamer',
    }, 'tenant-reaper');
    reloadBotSettings('tenant-athena');
    reloadBotSettings('tenant-reaper');
    await setBotShareMode('on', 'tenant-athena');
    await setBotShareMode('on', 'tenant-reaper');

    const request = {
      tenantId: 'tenant-athena',
      message: 'Athena, tell Reaper that the funniest joke today involved a cosmic trout.',
      actor: { username: 'commander', displayName: 'Commander', isOwner: true },
      location: {
        app: 'streamweaver',
        surface: 'discord-dm' as const,
        channelId: 'private-dm',
        live: false,
        replyMode: 'structured' as const,
      },
      visibility: 'private' as const,
      executeTools: true,
    };

    const decision = await decideAthenaAction(request);
    const outcome = await executeAthenaDecision(request, decision);

    assert.equal(decision.toolId, 'bot.group-memory.share');
    assert.equal(outcome.decision.executed, true);
    assert.equal(outcome.decision.delivered, false);
    assert.match(outcome.response || '', /shared bot memory for Reaper/i);
    assert.match(outcome.response || '', /did not send a live message/i);

    const sourceHistory = await readBotInteractionHistory(10, 'tenant-athena');
    const targetHistory = await readBotInteractionHistory(10, 'tenant-reaper');
    assert.equal(sourceHistory.length, 1);
    assert.equal(targetHistory.length, 1);
    assert.equal(targetHistory[0]?.kind, 'shared-memory');
    assert.equal(targetHistory[0]?.speakerBotName, 'Athena');
    assert.deepEqual(targetHistory[0]?.targetBotNames, ['Reaper']);
    assert.equal(targetHistory[0]?.delivered, false);
    assert.match(targetHistory[0]?.responseMessage || '', /cosmic trout/i);
  } finally {
    restoreEnv('PERSIST_ROOT', previousPersistRoot);
    await rm(persistRoot, { recursive: true, force: true });
  }
});
