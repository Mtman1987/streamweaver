import test from 'node:test';
import assert from 'node:assert/strict';

import { pickTwitchReplyChannel } from '../src/services/tenant-chat-routing';

test('keeps replies in the source channel when the responding tenant matches the source tenant', () => {
  assert.equal(
    pickTwitchReplyChannel({
      sourceChannel: 'jaskuthebeardedgamer',
      sourceTenantId: 'tenant-jasku',
      responseTenantId: 'tenant-jasku',
      responseTenantChannel: 'athenahome',
    }),
    'jaskuthebeardedgamer',
  );
});

test('routes cross-tenant replies back to the responding tenant home channel', () => {
  assert.equal(
    pickTwitchReplyChannel({
      sourceChannel: 'jaskuthebeardedgamer',
      sourceTenantId: 'tenant-jasku',
      responseTenantId: 'tenant-athena',
      responseTenantChannel: 'mtman1987',
    }),
    'mtman1987',
  );
});

test('falls back to the source channel if the target tenant channel is unavailable', () => {
  assert.equal(
    pickTwitchReplyChannel({
      sourceChannel: '#jaskuthebeardedgamer',
      sourceTenantId: 'tenant-jasku',
      responseTenantId: 'tenant-athena',
      responseTenantChannel: '',
    }),
    'jaskuthebeardedgamer',
  );
});
