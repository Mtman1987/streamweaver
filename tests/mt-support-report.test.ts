import test from 'node:test';
import assert from 'node:assert/strict';

import {
  beginPendingMtSupportRequest,
  consumePendingMtSupportRequest,
  detectMtFixItIntent,
  hasPendingMtSupportRequest,
} from '../src/services/mt-support-report';

test('detectMtFixItIntent supports command and voice alias forms', () => {
  assert.deepEqual(detectMtFixItIntent('!mtfixit obs crashed'), { matched: true, description: 'obs crashed' });
  assert.deepEqual(detectMtFixItIntent('mt fix it alerts are stuck'), { matched: true, description: 'alerts are stuck' });
  assert.deepEqual(detectMtFixItIntent('hello there'), { matched: false, description: '' });
});

test('pending support requests can be tracked per user context', () => {
  const context = { platform: 'twitch' as const, tenantId: 'tenant-1', username: 'MtUser', channelId: 'chan-1' };
  beginPendingMtSupportRequest(context);
  assert.equal(hasPendingMtSupportRequest(context), true);
  assert.equal(consumePendingMtSupportRequest(context), true);
  assert.equal(hasPendingMtSupportRequest(context), false);
});
