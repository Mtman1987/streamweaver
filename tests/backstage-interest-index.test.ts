import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

test('public stream monitoring queues only observations matching tenant interests', async () => {
  const persistRoot = await mkdtemp(path.join(os.tmpdir(), 'streamweaver-interest-index-'));
  const previousPersistRoot = process.env.PERSIST_ROOT;
  process.env.PERSIST_ROOT = persistRoot;

  try {
    const { writeUserConfig } = await import('../src/lib/user-config');
    const { reloadBotSettings } = await import('../src/lib/bot-settings-store');
    const {
      clearBackstageInterestIndexCache,
      publicObservationMatchesInterest,
      shouldQueueBackstagePublicObservation,
    } = await import('../src/services/backstage-interest-index');

    await writeUserConfig({
      AI_BOT_NAME: 'Reaper',
      AI_BOT_INTERESTS: 'jokes, horror',
      TWITCH_BROADCASTER_USERNAME: 'nephalem2',
    }, 'tenant-reaper');
    await writeUserConfig({
      AI_BOT_NAME: 'Scarlett',
      AI_BOT_INTERESTS: 'fishing, sarcasm',
      TWITCH_BROADCASTER_USERNAME: 'fatkid4ev4',
    }, 'tenant-scarlett');
    reloadBotSettings('tenant-reaper');
    reloadBotSettings('tenant-scarlett');
    clearBackstageInterestIndexCache();

    assert.equal(publicObservationMatchesInterest(
      'What do you call a cosmic trout ordering room service?',
      ['jokes', 'horror'],
    ), true);
    assert.equal(await shouldQueueBackstagePublicObservation(
      'What do you call a cosmic trout ordering room service?',
    ), true);
    assert.equal(await shouldQueueBackstagePublicObservation(
      'I finally found the right fishing lure for the nebula dock.',
    ), true);
    assert.equal(await shouldQueueBackstagePublicObservation(
      'The weather outside is mild today.',
    ), false);
  } finally {
    restoreEnv('PERSIST_ROOT', previousPersistRoot);
    await rm(persistRoot, { recursive: true, force: true });
  }
});
