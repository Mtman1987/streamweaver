import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const signal = fs.readFileSync('src/services/signal-system.ts', 'utf8');
const leader = fs.readFileSync('src/services/leaderboard-commands.ts', 'utf8');
const dispatcher = fs.readFileSync('src/services/chat-dispatcher.ts', 'utf8');

test('bare Twitch signal toggles Signal Seekers before entitlement checks', () => {
  const toggle = signal.indexOf('toggleDiscordStreamHubSignalSeeker');
  const entitlement = signal.lastIndexOf("provider: 'twitch'");
  assert.ok(toggle >= 0 && entitlement > toggle);
  assert.match(signal, /sendTwitchWhisper/);
});

test('leader output counts badges and all three eggs without verbose badge labels', () => {
  assert.match(leader, /Gym Badges: \$\{user\.badges\.length\}/);
  assert.match(leader, /Eggs Found: \$\{eggsFound\}\/3/);
  assert.doesNotMatch(leader, /user\.badges\.join\(', '\)/);
  assert.match(dispatcher, /name: 'Gym Badges'/);
  assert.match(dispatcher, /name: 'Eggs Found'/);
  assert.doesNotMatch(dispatcher, /name: 'Global badges'/);
});
