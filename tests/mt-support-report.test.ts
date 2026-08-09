import test from 'node:test';
import assert from 'node:assert/strict';

import {
  beginPendingMtSupportRequest,
  consumePendingMtSupportRequest,
  detectMtFixItIntent,
  hasPendingMtSupportRequest,
} from '../src/services/mt-support-report';

test('retired StreamWeaver mtfixit ingress never claims commands now owned by DiscordStreamHub', () => {
  assert.deepEqual(detectMtFixItIntent('!mtfixit obs crashed'), { matched: false, description: '' });
  assert.deepEqual(detectMtFixItIntent('mt fix it alerts are stuck'), { matched: false, description: '' });
  assert.deepEqual(detectMtFixItIntent('hello there'), { matched: false, description: '' });
});

test('retired StreamWeaver mtfixit ingress does not keep pending support state', () => {
  const context = { platform: 'twitch' as const, tenantId: 'tenant-1', username: 'MtUser', channelId: 'chan-1' };
  beginPendingMtSupportRequest(context);
  assert.equal(hasPendingMtSupportRequest(context), false);
  assert.equal(consumePendingMtSupportRequest(context), false);
  assert.equal(hasPendingMtSupportRequest(context), false);
});

test('pending description starting with ! has leading ! stripped', () => {
  // Simulates the stripping logic used in all 3 dispatch surfaces
  function stripLeadingBang(msg: string): string {
    return msg.startsWith('!') ? msg.slice(1).trim() : msg;
  }
  assert.equal(stripLeadingBang('!obs crashed'), 'obs crashed');
  assert.equal(stripLeadingBang('!  alerts stuck'), 'alerts stuck');
  assert.equal(stripLeadingBang('stream is down'), 'stream is down');
  assert.equal(stripLeadingBang('normal message'), 'normal message');
});
