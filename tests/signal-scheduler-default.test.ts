import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const patch = fs.readFileSync('scripts/patch-signal-scheduler-default.mjs', 'utf8');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const countPatch = fs.readFileSync('scripts/patch-the-count-easter-egg.mjs', 'utf8');

test('Signal scheduler defaults on unless explicitly disabled', () => {
  assert.match(patch, /SIGNAL_SCHEDULER_ENABLED !== 'false'/);
  assert.match(patch, /SIGNAL_SCHEDULER_ENABLED === 'true'/);
  assert.match(patch, /refusing to patch blindly/);
  assert.match(pkg.scripts.prebuild, /patch-signal-system\.mjs.*patch-signal-scheduler-default\.mjs/);
  assert.match(pkg.scripts['prebuild:simple'], /patch-signal-system\.mjs.*patch-signal-scheduler-default\.mjs/);
});

test('Count direct summon remains Black Hole egg gated', () => {
  assert.match(countPatch, /entitlement\.eggs\.blackHole/);
  assert.doesNotMatch(countPatch, /entitlement\.title === THE_COUNT_OWNER_TITLE/);
});
