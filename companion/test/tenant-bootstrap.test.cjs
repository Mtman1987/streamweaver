'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  BOOTSTRAP_EXCHANGE_URL,
  exchangeTenantBootstrap,
  findTenantBootstrapUrl,
  parseTenantBootstrapUrl,
} = require('../lib/tenant-bootstrap.cjs');

test('tenant bootstrap accepts only the registered one-time Companion URL', () => {
  assert.deepEqual(parseTenantBootstrapUrl('spmt-companion://bootstrap?code=one-time-code'), { code: 'one-time-code' });
  assert.equal(parseTenantBootstrapUrl('https://spmt.live/?code=one-time-code'), null);
  assert.equal(parseTenantBootstrapUrl('spmt-companion://other?code=one-time-code'), null);
  assert.equal(parseTenantBootstrapUrl('spmt-companion://bootstrap'), null);
  assert.equal(findTenantBootstrapUrl(['app.exe', '--hidden', 'spmt-companion://bootstrap?code=abc']), 'spmt-companion://bootstrap?code=abc');
});

test('tenant bootstrap exchanges the code without putting it in a URL or loggable header', async () => {
  let request;
  const payload = {
    sessionToken: 'session-token',
    user: { id: 'tenant-1', username: 'tester' },
    device: { id: 'device-1' },
    pairingToken: 'relay-token',
  };
  const result = await exchangeTenantBootstrap(async (url, init) => {
    request = { url, init };
    return { ok: true, status: 200, json: async () => payload };
  }, 'one-time-code');

  assert.equal(request.url, BOOTSTRAP_EXCHANGE_URL);
  assert.deepEqual(JSON.parse(request.init.body), { code: 'one-time-code' });
  assert.equal(request.init.headers.Authorization, undefined);
  assert.deepEqual(result, payload);
});
