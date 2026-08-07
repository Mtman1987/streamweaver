import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

test('private tell-a-bot intent selects the existing group-memory tool instead of live delivery', async () => {
  const persistRoot = await mkdtemp(path.join(os.tmpdir(), 'streamweaver-athena-group-intent-'));
  const previousPersistRoot = process.env.PERSIST_ROOT;
  process.env.PERSIST_ROOT = persistRoot;

  try {
    const { writeUserConfig } = await import('../src/lib/user-config');
    const { reloadBotSettings } = await import('../src/lib/bot-settings-store');
    const { decideAthenaAction } = await import('../src/services/athena-tools');

    await writeUserConfig({
      AI_BOT_NAME: 'Athena',
      AI_BOT_ALIASES: 'Annie,Athenabot87',
      AI_BOT_PERSONALITY: 'Responsible archive steward.',
    }, 'tenant-athena');
    reloadBotSettings('tenant-athena');

    const decision = await decideAthenaAction({
      tenantId: 'tenant-athena',
      message: 'Athena, tell Reaper that the funniest joke today involved a cosmic trout.',
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
    assert.equal(decision.toolId, 'bot.group-memory.share');
    assert.equal(decision.arguments?.targetName, 'Reaper');
    assert.match(String(decision.arguments?.memoryText || ''), /cosmic trout/i);
    assert.equal(decision.delivered, undefined);
  } finally {
    restoreEnv('PERSIST_ROOT', previousPersistRoot);
    await rm(persistRoot, { recursive: true, force: true });
  }
});

test('shared bot memory is copied only to mutually opted-in participant tenants', async () => {
  const persistRoot = await mkdtemp(path.join(os.tmpdir(), 'streamweaver-athena-group-memory-'));
  const previousPersistRoot = process.env.PERSIST_ROOT;
  process.env.PERSIST_ROOT = persistRoot;

  try {
    const {
      appendSharedBotMemory,
      formatBotInteractionHistoryForPrompt,
      readBotInteractionHistory,
      setBotShareMode,
    } = await import('../src/lib/bot-interactions-store');

    await setBotShareMode('on', 'tenant-athena');
    await setBotShareMode('on', 'tenant-reaper');

    await appendSharedBotMemory({
      sourceTenantId: 'tenant-athena',
      targetTenantId: 'tenant-reaper',
      platform: 'app',
      sourceUser: 'Commander',
      speaker: {
        stableId: '94371378:athena',
        currentName: 'Athena',
        aliases: ['Athenabot87'],
      },
      target: {
        stableId: 'unknown:reaper',
        currentName: 'Reaper',
        aliases: ['Reaper'],
      },
      triggerMessage: 'Tell Reaper the cosmic trout joke.',
      memoryText: 'The funniest joke today involved a cosmic trout ordering room service.',
    });

    const sourceHistory = await readBotInteractionHistory(10, 'tenant-athena');
    const targetHistory = await readBotInteractionHistory(10, 'tenant-reaper');
    const outsiderHistory = await readBotInteractionHistory(10, 'tenant-scarlett');

    assert.equal(sourceHistory.length, 1);
    assert.equal(targetHistory.length, 1);
    assert.equal(outsiderHistory.length, 0);
    assert.equal(targetHistory[0]?.kind, 'shared-memory');
    assert.equal(targetHistory[0]?.delivered, false);
    assert.equal(targetHistory[0]?.speakerBotName, 'Athena');
    assert.deepEqual(targetHistory[0]?.targetBotNames, ['Reaper']);
    assert.match(targetHistory[0]?.responseMessage || '', /cosmic trout/i);

    const prompt = await formatBotInteractionHistoryForPrompt(10, 'tenant-reaper');
    assert.match(prompt, /Shared group memory/i);
    assert.match(prompt, /Athena shared with Reaper/i);
    assert.match(prompt, /not sent as a live chat message/i);

    await setBotShareMode('off', 'tenant-reaper');
    await assert.rejects(
      appendSharedBotMemory({
        sourceTenantId: 'tenant-athena',
        targetTenantId: 'tenant-reaper',
        platform: 'app',
        sourceUser: 'Commander',
        speaker: { stableId: '94371378:athena', currentName: 'Athena' },
        target: { stableId: 'unknown:reaper', currentName: 'Reaper' },
        triggerMessage: 'Tell Reaper another joke.',
        memoryText: 'Another joke.',
      }),
      /both tenant bots must enable bot sharing/i,
    );
  } finally {
    restoreEnv('PERSIST_ROOT', previousPersistRoot);
    await rm(persistRoot, { recursive: true, force: true });
  }
});

test('the canonical lore keeps existing sister lore and adds Moonbeam as Athena best friend', async () => {
  const persistRoot = await mkdtemp(path.join(os.tmpdir(), 'streamweaver-athena-lore-'));
  const previousPersistRoot = process.env.PERSIST_ROOT;
  process.env.PERSIST_ROOT = persistRoot;

  try {
    const { readWorldLore } = await import('../src/lib/world-lore-store');
    const lore = await readWorldLore();

    const sisters = lore.relationships.athena_scarlett_sisters;
    assert.ok(sisters);
    assert.match(sisters.label, /adopted pretend sisters/i);
    assert.deepEqual(sisters.characterIds, ['94371378:athena', 'unknown:scarlett']);

    const bestFriends = lore.relationships.athena_moonbeam_best_friends;
    assert.ok(bestFriends);
    assert.match(bestFriends.label, /best friends/i);
    assert.deepEqual(bestFriends.characterIds, ['94371378:athena', 'unknown:moonbeam']);
    assert.ok(lore.characters['94371378:athena']?.relationshipIds?.includes('athena_moonbeam_best_friends'));
    assert.ok(lore.characters['unknown:moonbeam']?.relationshipIds?.includes('athena_moonbeam_best_friends'));
  } finally {
    restoreEnv('PERSIST_ROOT', previousPersistRoot);
    await rm(persistRoot, { recursive: true, force: true });
  }
});
