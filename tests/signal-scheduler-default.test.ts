import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const signal = fs.readFileSync('src/services/signal-system.ts', 'utf8');
const countPatch = fs.readFileSync('scripts/patch-the-count-easter-egg.mjs', 'utf8');
const dispatcher = fs.readFileSync('src/services/chat-dispatcher.ts', 'utf8');
const server = fs.readFileSync('server.ts', 'utf8');

test('Signal scheduler remains permanently disabled', () => {
  assert.match(signal, /enabled: false, bag: \[\], nextAt: 0/);
  assert.match(signal, /return \{ enabled: false, nextAt: 0 \}/);
  assert.doesNotMatch(signal, /schedulerTimer = setInterval/);
  assert.doesNotMatch(dispatcher, /cmdName === 'signalbot'/);
  assert.doesNotMatch(server, /startSignalScheduler/);
});

test('Count direct summon remains Black Hole egg gated', () => {
  assert.match(countPatch, /entitlement\.eggs\.blackHole/);
  assert.doesNotMatch(countPatch, /entitlement\.title === THE_COUNT_OWNER_TITLE/);
});
