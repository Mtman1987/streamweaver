import test from 'node:test';
import assert from 'node:assert/strict';

import { shouldPollerDispatchDiscordMessage } from '../src/services/discord-poller-filter';

test('poller skips public Discord commands so webhook command handling stays authoritative', () => {
  assert.equal(shouldPollerDispatchDiscordMessage('!highfive fultztrain420'), false);
  assert.equal(shouldPollerDispatchDiscordMessage('  !points  '), false);
});

test('poller still dispatches normal public chat messages', () => {
  assert.equal(shouldPollerDispatchDiscordMessage('hello discord'), true);
});

test('poller ignores bridged and empty messages', () => {
  assert.equal(shouldPollerDispatchDiscordMessage('[Twitch] Mtman1987: hi'), false);
  assert.equal(shouldPollerDispatchDiscordMessage('   '), false);
});
