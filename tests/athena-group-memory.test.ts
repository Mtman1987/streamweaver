import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

test('backstage lore stays active while botshare gates only visible bot chatter', async () => {
  const persistRoot = await mkdtemp(path.join(os.tmpdir(), 'streamweaver-backstage-lore-'));
  const previousPersistRoot = process.env.PERSIST_ROOT;
  const previousScheduler = process.env.BACKSTAGE_LORE_DISABLE_SCHEDULER;
  process.env.PERSIST_ROOT = persistRoot;
  process.env.BACKSTAGE_LORE_DISABLE_SCHEDULER = 'true';

  try {
    const {
      appendBackstageLoreMemory,
      decideBotInteraction,
      formatBotInteractionHistoryForPrompt,
      readBotInteractionHistory,
      setBotShareMode,
    } = await import('../src/lib/bot-interactions-store');
    const { readWorldLore } = await import('../src/lib/world-lore-store');

    await setBotShareMode('off', 'tenant-athena');
    await setBotShareMode('off', 'tenant-reaper');

    await appendBackstageLoreMemory({
      sourceTenantId: 'tenant-athena',
      targetTenantId: 'tenant-reaper',
      platform: 'app',
      sourceUser: 'Backstage',
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
      triggerMessage: 'Athena noticed a joke that matched Reaper interests.',
      memoryText: 'Athena tucked a cosmic trout joke into Reaper’s abyssal joke ledger.',
      sourceEventId: 'event-cosmic-trout',
      interestTags: ['jokes'],
      origin: 'interest-ingestion',
      delivered: false,
    });

    const sourceHistory = await readBotInteractionHistory(10, 'tenant-athena');
    const targetHistory = await readBotInteractionHistory(10, 'tenant-reaper');
    const outsiderHistory = await readBotInteractionHistory(10, 'tenant-scarlett');

    assert.equal(sourceHistory.length, 1);
    assert.equal(targetHistory.length, 1);
    assert.equal(outsiderHistory.length, 0);
    assert.equal(targetHistory[0]?.kind, 'backstage-lore');
    assert.equal(targetHistory[0]?.origin, 'interest-ingestion');
    assert.equal(targetHistory[0]?.delivered, false);
    assert.deepEqual(targetHistory[0]?.interestTags, ['jokes']);

    const prompt = await formatBotInteractionHistoryForPrompt(10, 'tenant-reaper');
    assert.match(prompt, /living backstage lore/i);
    assert.match(prompt, /cosmic trout/i);
    assert.match(prompt, /not posted as live bot chatter/i);

    const offDecision = await decideBotInteraction({
      message: 'Athena, ask Reaper what he thought of the joke.',
      currentBotName: 'Athena',
      tenantId: 'tenant-athena',
      platform: 'discord',
    });
    assert.equal(offDecision, null, 'botshare off must suppress visible name-trigger chatter');

    await setBotShareMode('on', 'tenant-athena');
    await setBotShareMode('on', 'tenant-reaper');
    const onDecision = await decideBotInteraction({
      message: 'Athena, ask Reaper what he thought of the joke.',
      currentBotName: 'Athena',
      tenantId: 'tenant-athena',
      platform: 'discord',
    });
    assert.equal(onDecision?.shouldRespond, true);
    assert.equal(onDecision?.speaker.currentName, 'Athena');
    assert.ok(onDecision?.targets.some((target) => target.currentName === 'Reaper'));

    const lore = await readWorldLore();
    assert.ok(lore);
    const sisters = lore?.relationships?.athena_scarlett_sisters;
    assert.ok(sisters);
    assert.match(sisters?.label || '', /adopted pretend sisters/i);
    assert.deepEqual(sisters?.characterIds, ['94371378:athena', 'unknown:scarlett']);

    const bestFriends = lore?.relationships?.athena_moonbeam_best_friends;
    assert.ok(bestFriends);
    assert.match(bestFriends?.label || '', /best friends/i);
    assert.deepEqual(bestFriends?.characterIds, ['94371378:athena', 'unknown:moonbeam']);
  } finally {
    restoreEnv('PERSIST_ROOT', previousPersistRoot);
    restoreEnv('BACKSTAGE_LORE_DISABLE_SCHEDULER', previousScheduler);
    await rm(persistRoot, { recursive: true, force: true });
  }
});
