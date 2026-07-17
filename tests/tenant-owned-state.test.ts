import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('translation and classic gamble state stay isolated by tenant', async () => {
  const persistRoot = await mkdtemp(path.join(os.tmpdir(), 'streamweaver-tenant-state-'));
  process.env.PERSIST_ROOT = persistRoot;

  try {
    const translation = await import('../src/services/translation-manager');
    translation.clearTranslationStateForTests();

    await translation.addUserToAutoTranslate('ViewerOne', 'tenant-a');
    translation.setTranslationMode(true, 'tenant-a');

    assert.equal(await translation.isUserAutoTranslate('viewerone', 'tenant-a'), true);
    assert.equal(await translation.isUserAutoTranslate('viewerone', 'tenant-b'), false);
    assert.equal(translation.isTranslationActive('tenant-a'), true);
    assert.equal(translation.isTranslationActive('tenant-b'), false);

    translation.clearTranslationStateForTests();
    assert.deepEqual(await translation.getAutoTranslateUsers('tenant-a'), ['viewerone']);
    assert.deepEqual(await translation.getAutoTranslateUsers('tenant-b'), []);

    const persistedTranslation = JSON.parse(await readFile(
      path.join(persistRoot, 'tenants', 'tenant-a', 'data', 'auto-translate-users.json'),
      'utf-8',
    ));
    assert.deepEqual(persistedTranslation.users, ['viewerone']);

    const gamble = await import('../src/services/gamble/classic-gamble');
    await gamble.updateSettings({ currencyName: 'Moon Rocks', minBet: 25 }, 'tenant-a');
    const tenantA = await gamble.getSettings('tenant-a');
    const tenantB = await gamble.getSettings('tenant-b');

    assert.equal(tenantA.currencyName, 'Moon Rocks');
    assert.equal(tenantA.minBet, 25);
    assert.equal(tenantB.currencyName, 'Points');
    assert.equal(tenantB.minBet, 0);

    const persistedA = JSON.parse(await readFile(
      path.join(persistRoot, 'tenants', 'tenant-a', 'data', 'gamble-settings.json'),
      'utf-8',
    ));
    const persistedB = JSON.parse(await readFile(
      path.join(persistRoot, 'tenants', 'tenant-b', 'data', 'gamble-settings.json'),
      'utf-8',
    ));
    assert.equal(persistedA.currencyName, 'Moon Rocks');
    assert.equal(persistedB.currencyName, 'Points');

    const userStats = await import('../src/services/user-stats');
    userStats.clearUserStatsCacheForTests();
    const statsCtxA = { tenantId: 'tenant-a', username: 'channel-a' };
    const statsCtxB = { tenantId: 'tenant-b', username: 'channel-b' };

    await userStats.incrementWatchtime(['shared-viewer'], 'channel-a', statsCtxA);
    await userStats.incrementWatchtime(['shared-viewer'], 'channel-b', statsCtxB);
    await userStats.incrementWatchtime(['shared-viewer'], 'channel-b', statsCtxB);

    assert.equal((await userStats.getUser('shared-viewer', statsCtxA)).watchtime, 1);
    assert.equal((await userStats.getUser('shared-viewer', statsCtxB)).watchtime, 2);

    userStats.clearUserStatsCacheForTests();
    assert.equal((await userStats.getUser('shared-viewer', statsCtxA)).watchtime, 1);
    assert.equal((await userStats.getUser('shared-viewer', statsCtxB)).watchtime, 2);

    const botInteractions = await import('../src/lib/bot-interactions-store');
    await botInteractions.appendBotInteraction({
      platform: 'twitch',
      tenantId: 'tenant-a',
      sourceUser: 'viewer-a',
      speakerBotId: 'tenant-a:bot',
      speakerBotName: 'Bot A',
      targetBotIds: ['tenant-a:target'],
      targetBotNames: ['Target A'],
      triggerMessage: 'hello a',
      responseMessage: 'private history a',
    });
    await botInteractions.appendBotInteraction({
      platform: 'discord',
      tenantId: 'tenant-b',
      sourceUser: 'viewer-b',
      speakerBotId: 'tenant-b:bot',
      speakerBotName: 'Bot B',
      targetBotIds: ['tenant-b:target'],
      targetBotNames: ['Target B'],
      triggerMessage: 'hello b',
      responseMessage: 'private history b',
    });

    const promptA = await botInteractions.formatBotInteractionHistoryForPrompt(8, 'tenant-a');
    const promptB = await botInteractions.formatBotInteractionHistoryForPrompt(8, 'tenant-b');
    assert.match(promptA, /private history a/);
    assert.doesNotMatch(promptA, /private history b/);
    assert.match(promptB, /private history b/);
    assert.doesNotMatch(promptB, /private history a/);

    const metrics = await import('../src/services/metrics');
    await metrics.incrementMetric('totalCommands', 1, 'tenant-a');
    await metrics.incrementMetric('totalCommands', 1, 'tenant-a');
    await metrics.incrementMetric('totalCommands', 1, 'tenant-b');
    assert.equal(metrics.getMetrics('tenant-a').totalCommands, 2);
    assert.equal(metrics.getMetrics('tenant-b').totalCommands, 1);
  } finally {
    await rm(persistRoot, { recursive: true, force: true });
  }
});

test('the metrics polling sweep updates every configured tenant explicitly', async () => {
  const serverSource = await readFile(new URL('../server.ts', import.meta.url), 'utf8');
  const metricsTask = serverSource.match(/addTask\('metrics',[\s\S]*?\}, 120000\);/)?.[0] || '';
  assert.match(metricsTask, /listTenants/);
  assert.match(metricsTask, /updateMetrics\(tenantId\)/);
  assert.doesNotMatch(metricsTask, /updateMetrics\(\s*\)/);
});
