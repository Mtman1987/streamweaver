import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const signal = fs.readFileSync('src/services/signal-system.ts', 'utf8');
const countPatch = fs.readFileSync('scripts/patch-the-count-easter-egg.mjs', 'utf8');

test('Signal scheduler requires an explicit toggle before posting clues', () => {
  assert.match(signal, /SIGNAL_SCHEDULER_STATE, \{ enabled: false/);
  assert.match(signal, /if \(state\.enabled !== true\) \{/);
  assert.match(signal, /export async function toggleSignalScheduler/);
});

test('Count direct summon remains Black Hole egg gated', () => {
  assert.match(countPatch, /entitlement\.eggs\.blackHole/);
  assert.doesNotMatch(countPatch, /entitlement\.title === THE_COUNT_OWNER_TITLE/);
});
