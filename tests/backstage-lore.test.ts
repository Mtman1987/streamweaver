import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

test('tenant interests collect useful lore and idle bots create backstage continuity without botshare', async () => {
  const persistRoot = await mkdtemp(path.join(os.tmpdir(), 'streamweaver-living-lore-'));
  const previousPersistRoot = process.env.PERSIST_ROOT;
  const previousScheduler = process.env.BACKSTAGE_LORE_DISABLE_SCHEDULER;
  process.env.PERSIST_ROOT = persistRoot;
  process.env.BACKSTAGE_LORE_DISABLE_SCHEDULER = 'true';

  try {
    const { writeUserConfig } = await import('../src/lib/user-config');
    const { reloadBotSettings } = await import('../src/lib/bot-settings-store');
    const { readBotInteractionHistory, setBotShareMode } = await import('../src/lib/bot-interactions-store');
    const {
      matchInterestTags,
      queueBackstageConversationTurn,
      runBackstageLoreCycle,
    } = await import('../src/services/backstage-lore');
    const { readWorldLoreJournal } = await import('../src/lib/world-lore-store');

    await writeUserConfig({
      AI_BOT_NAME: 'Athena',
      AI_BOT_ALIASES: 'Annie,Athenabot87',
      AI_BOT_INTERESTS: 'space, archives',
      AI_BOT_PERSONALITY: 'Responsible archive steward.',
      TWITCH_BROADCASTER_USERNAME: 'commander',
    }, 'tenant-athena');
    await writeUserConfig({
      AI_BOT_NAME: 'Reaper',
      AI_BOT_ALIASES: 'The Reaper',
      AI_BOT_INTERESTS: 'jokes, horror',
      AI_BOT_PERSONALITY: 'Theatrical abyssal guardian.',
      TWITCH_BROADCASTER_USERNAME: 'nephalem2',
    }, 'tenant-reaper');
    await writeUserConfig({
      AI_BOT_NAME: 'Scarlett',
      AI_BOT_INTERESTS: 'fishing, sarcasm',
      AI_BOT_PERSONALITY: 'Sarcastic fisher-witch bartender.',
      TWITCH_BROADCASTER_USERNAME: 'fatkid4ev4',
    }, 'tenant-scarlett');
    reloadBotSettings('tenant-athena');
    reloadBotSettings('tenant-reaper');
    reloadBotSettings('tenant-scarlett');

    await setBotShareMode('off', 'tenant-athena');
    await setBotShareMode('off', 'tenant-reaper');
    await setBotShareMode('off', 'tenant-scarlett');

    assert.deepEqual(
      matchInterestTags('What do you call a cosmic trout ordering room service?', ['jokes', 'horror']),
      ['jokes'],
    );

    await queueBackstageConversationTurn({
      tenantId: 'tenant-athena',
      visibility: 'private',
      sourceUser: 'Commander',
      botName: 'Athena',
      message: 'What do you call a cosmic trout ordering room service?',
      response: 'A reel guest.',
      conversationId: 'discord-dm:commander',
      platform: 'discord',
      channelId: 'commander-private-dm',
    });

    const tenantQueuePath = path.join(
      persistRoot,
      'tenants',
      'tenant-athena',
      'data',
      'backstage-lore',
      'queue.json',
    );
    const rawQueue = JSON.parse(await readFile(tenantQueuePath, 'utf-8'));
    assert.equal(rawQueue.length, 1);
    assert.equal(rawQueue[0]?.sourceTenantId, 'tenant-athena');
    assert.equal(rawQueue[0]?.visibility, 'private');
    assert.match(rawQueue[0]?.text || '', /cosmic trout/i);

    const obsoleteGlobalQueuePath = path.join(persistRoot, 'global', 'backstage-lore', 'queue.json');
    await assert.rejects(
      access(obsoleteGlobalQueuePath),
      (error: any) => error?.code === 'ENOENT',
      'unclassified private conversation text must never be written to a global queue',
    );

    const firstCycle = await runBackstageLoreCycle({
      maxCandidates: 3,
      classifyCandidate: async (_candidate, _source, targets) => {
        const reaper = targets.find((target) => target.tenantId === 'tenant-reaper');
        assert.ok(reaper);
        return {
          shareable: true,
          memoryText: 'Athena saved a cosmic trout room-service joke in Reaper’s abyssal comedy ledger.',
          matches: [{ tenantId: 'tenant-reaper', tags: ['jokes'] }],
        };
      },
    });
    assert.equal(firstCycle.processed, 1);

    const athenaHistory = await readBotInteractionHistory(20, 'tenant-athena');
    const reaperHistory = await readBotInteractionHistory(20, 'tenant-reaper');
    const scarlettHistory = await readBotInteractionHistory(20, 'tenant-scarlett');
    assert.equal(athenaHistory.length, 1);
    assert.equal(reaperHistory.length, 1);
    assert.equal(scarlettHistory.length, 0);
    assert.equal(reaperHistory[0]?.origin, 'interest-ingestion');
    assert.equal(reaperHistory[0]?.delivered, false);
    assert.deepEqual(reaperHistory[0]?.interestTags, ['jokes']);

    const journalAfterInterest = await readWorldLoreJournal(20);
    assert.equal(journalAfterInterest.length, 1);
    assert.match(journalAfterInterest[0]?.summary || '', /cosmic trout/i);
    assert.deepEqual(journalAfterInterest[0]?.participantTenantIds.sort(), ['tenant-athena', 'tenant-reaper']);

    const idleCycle = await runBackstageLoreCycle({
      forceIdle: true,
      now: new Date('2026-08-07T22:30:00.000Z'),
      generateIdleScene: async (source, target, _relationship, interestTag) => ({
        memoryText: `${source.botName} and ${target.botName} traded one quiet backstage thought about ${interestTag}.`,
        interestTags: [interestTag],
      }),
    });
    assert.equal(idleCycle.idleSceneCreated, true);

    const journalAfterIdle = await readWorldLoreJournal(20);
    assert.equal(journalAfterIdle.length, 2);
    assert.equal(journalAfterIdle[1]?.origin, 'idle-scene');
    assert.match(journalAfterIdle[1]?.summary || '', /backstage thought/i);
  } finally {
    restoreEnv('PERSIST_ROOT', previousPersistRoot);
    restoreEnv('BACKSTAGE_LORE_DISABLE_SCHEDULER', previousScheduler);
    await rm(persistRoot, { recursive: true, force: true });
  }
});
