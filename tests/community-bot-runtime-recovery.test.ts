import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.cwd());
const patch = fs.readFileSync(path.join(root, 'scripts/patch-signal-carrier-runtime-recovery.mjs'), 'utf8');
const dockerfile = fs.readFileSync(path.join(root, 'Dockerfile'), 'utf8');

test('community bot failed setup is retryable and OAuth resets runtime state', () => {
  assert.match(patch, /communityBotConnectPromise = null/);
  assert.match(patch, /Credential file not found/);
  assert.match(patch, /Credentials incomplete/);
  assert.match(patch, /\/api\/twitch\/community-bot\/reconnect/);
  assert.match(patch, /disconnectCommunityBot/);
  assert.match(patch, /syncSignalCarrierRosterOnce/);
  assert.match(patch, /Community bot credentials stored/);
});

test('Fly build applies community bot recovery after Signal generation', () => {
  assert.match(dockerfile, /patch-signal-system\.mjs/);
  assert.match(dockerfile, /patch-signal-carrier-join-hardening\.mjs/);
  assert.match(dockerfile, /patch-signal-carrier-runtime-recovery\.mjs/);
  assert.ok(
    dockerfile.indexOf('patch-signal-carrier-runtime-recovery.mjs') > dockerfile.indexOf('patch-signal-carrier-join-hardening.mjs'),
  );
});
