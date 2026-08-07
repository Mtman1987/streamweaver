import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

test('packaged canonical lore augments an older persisted Fly volume without deleting custom lore', async () => {
  const persistRoot = await mkdtemp(path.join(os.tmpdir(), 'streamweaver-lore-merge-'));
  const previousPersistRoot = process.env.PERSIST_ROOT;
  process.env.PERSIST_ROOT = persistRoot;

  try {
    const globalDir = path.join(persistRoot, 'global');
    await mkdir(globalDir, { recursive: true });
    await writeFile(path.join(globalDir, 'world-lore.json'), JSON.stringify({
      schemaVersion: 1,
      worldId: 'space_mountain_multiverse',
      title: 'Persisted Station Lore',
      overview: ['A persisted custom overview.'],
      characters: {
        '94371378:athena': {
          stableId: '94371378:athena',
          currentName: 'Athena Prime',
          aliases: ['Annie'],
          personalityNotes: ['A persisted custom Athena note.'],
          relationshipIds: ['athena_scarlett_sisters'],
        },
        'custom:orbit': {
          stableId: 'custom:orbit',
          currentName: 'Orbit',
          summary: 'A custom bot added directly to the persistent lore.',
        },
      },
      relationships: {
        athena_scarlett_sisters: {
          characterIds: ['94371378:athena', 'unknown:scarlett'],
          label: 'Old sister label',
          summary: 'An older persisted copy of the relationship.',
        },
        custom_orbit_friendship: {
          characterIds: ['custom:orbit', '94371378:athena'],
          label: 'Custom friendship',
          summary: 'Custom lore must survive canonical updates.',
        },
      },
    }, null, 2));

    const { readWorldLore } = await import('../src/lib/world-lore-store');
    const lore = await readWorldLore();
    assert.ok(lore);
    assert.equal(lore?.title, 'Persisted Station Lore');
    assert.ok(lore?.overview?.includes('A persisted custom overview.'));
    assert.ok(lore?.overview?.some((line) => /Celestial Rail/i.test(line)));

    const athena = lore?.characters?.['94371378:athena'];
    assert.equal(athena?.currentName, 'Athena Prime');
    assert.ok(athena?.aliases?.includes('Athena'));
    assert.ok(athena?.aliases?.includes('Annie'));
    assert.ok(athena?.personalityNotes?.includes('A persisted custom Athena note.'));
    assert.ok(athena?.relationshipIds?.includes('athena_moonbeam_best_friends'));

    assert.equal(lore?.characters?.['custom:orbit']?.currentName, 'Orbit');
    assert.equal(lore?.relationships?.athena_scarlett_sisters?.label, 'Adopted pretend sisters');
    assert.ok(lore?.relationships?.athena_moonbeam_best_friends);
    assert.equal(lore?.relationships?.custom_orbit_friendship?.label, 'Custom friendship');
  } finally {
    restoreEnv('PERSIST_ROOT', previousPersistRoot);
    await rm(persistRoot, { recursive: true, force: true });
  }
});
