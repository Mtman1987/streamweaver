const { test } = require('node:test');
const assert = require('node:assert/strict');
const { RestreamHost, allowedNavigation, localPreviewRedirect } = require('../lib/restream-host.cjs');
test('the host blocks arbitrary navigation and redirects only its own local overlay preview', () => {
  assert.equal(allowedNavigation('https://studio.restream.io'), true);
  assert.equal(allowedNavigation('https://restream.io.evil.example'), false);
  assert.equal(allowedNavigation('file:///secret'), false);
  const url = 'https://spmt.live/tenant/thecaptaindash/public';
  assert.equal(localPreviewRedirect({ resourceType: 'subFrame', url }, 'thecaptaindash'), url + '?localControllerPreview=off');
  assert.equal(localPreviewRedirect({ resourceType: 'mainFrame', url }, 'thecaptaindash'), null);
  assert.equal(localPreviewRedirect({ resourceType: 'subFrame', url }, 'other'), null);
});
test('a refused cloud handoff never creates a local window', async () => {
  let created = false;
  const host = new RestreamHost({ electron: { session: { defaultSession: { fetch: async () => ({ ok: false, json: async () => ({ error: 'Cloud host running' }) }) } }, BrowserWindow: class { constructor() { created = true; } } }, getConfig: () => ({ relay: { deviceId: 'pc1' } }), getToken: () => 'private' });
  await assert.rejects(host.open(), /Cloud host running/);
  assert.equal(created, false); assert.equal(host.status().running, false);
});
test('host destruction stops the browser before a reservation can become available again', () => {
  const host = new RestreamHost({ electron: {}, getConfig: () => ({}), getToken: () => '' });
  let destroyed = false;
  host.window = { isDestroyed: () => false, destroy: () => { destroyed = true; } };
  host.destroy(); assert.equal(destroyed, true); assert.equal(host.status().running, false);
});
test('opening Studio claims ownership first, keeps a tenant-isolated profile, and closes before release', async () => {
  const order = [], events = {};
  class Window {
    constructor(options) { this.options = options; this.dead = false; order.push('window'); this.webContents = { on() {}, setWindowOpenHandler() {}, setUserAgent() {} }; }
    on(name, fn) { events[name] = fn; }
    isDestroyed() { return this.dead; }
    async loadURL(url) { order.push('load'); assert.equal(url, 'https://studio.restream.io'); }
    show() {} focus() {} hide() { order.push('hide'); }
    destroy() { this.dead = true; order.push('destroy'); }
  }
  const ses = { webRequest: { onBeforeRequest() {} }, setPermissionRequestHandler() {}, setDisplayMediaRequestHandler() {}, getUserAgent: () => 'Chrome Electron/35.0' };
  const host = new RestreamHost({ electron: { BrowserWindow: Window, session: { fromPartition: p => { assert.match(p, /^persist:spmt-restream-[a-f0-9]+$/); return ses; }, defaultSession: { fetch: async (url) => { const action = url.split('/').pop(); order.push(action); return { ok: true, json: async () => ({ username: 'thecaptaindash', expiresAt: Date.now() + 90000 }) }; } } } }, getConfig: () => ({ relay: { deviceId: 'pc1' } }), getToken: () => 'private' });
  await host.open(); assert.deepEqual(order.slice(0,3), ['claim', 'window', 'load']);
  events.close({ preventDefault() {} }); assert.equal(host.status().running, true); assert.equal(order.at(-1), 'hide');
  await host.stop(false); assert.deepEqual(order.slice(-2), ['destroy', 'release']);
});
