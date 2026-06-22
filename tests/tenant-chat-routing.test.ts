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

test('keeps cross-tenant replies in the source channel', () => {
  assert.equal(
    pickTwitchReplyChannel({
      sourceChannel: 'jaskuthebeardedgamer',
      sourceTenantId: 'tenant-jasku',
      responseTenantId: 'tenant-athena',
      responseTenantChannel: 'mtman1987',
    }),
    'jaskuthebeardedgamer',
  );
});

test('normalizes source channel even when target tenant channel is unavailable', () => {
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
