import test from 'node:test';
import assert from 'node:assert/strict';

import { shouldDispatchIncomingFromCommunityBot } from '../src/services/twitch-client';

test('community bot skips inbound dispatch when broadcaster chat client is already usable', () => {
  const broadcasterClient = {
    readyState: () => 'OPEN',
  } as any;

  assert.equal(shouldDispatchIncomingFromCommunityBot(broadcasterClient), false);
});

test('community bot remains authoritative when broadcaster chat client is unavailable', () => {
  assert.equal(shouldDispatchIncomingFromCommunityBot(null), true);
  assert.equal(shouldDispatchIncomingFromCommunityBot({ readyState: () => 'CLOSED' } as any), true);
});
