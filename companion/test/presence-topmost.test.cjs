'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const mainPath = path.resolve(__dirname, '..', 'main.cjs');

test('Companion runtime enforces topmost overlay and publishes canonical presence', () => {
  const source = fs.readFileSync(mainPath, 'utf8');
  assert.match(source, /SPMT_PRESENCE_ENDPOINT\s*=\s*'https:\/\/spmt\.live\/api\/presence\/heartbeat'/);
  assert.match(source, /appId:\s*'companion'/);
  assert.match(source, /COMPANION_PRESENCE_INTERVAL_MS\s*=\s*25_000/);
  assert.match(source, /function enforceOverlayAlwaysOnTop/);
  assert.match(source, /setAlwaysOnTop\(true/);
  assert.match(source, /setVisibleOnAllWorkspaces\(true/);
  assert.match(source, /always-on-top-changed/);
  assert.match(source, /startCompanionPresence\(\)/);
  assert.match(source, /stopCompanionPresence\(\)/);
});
