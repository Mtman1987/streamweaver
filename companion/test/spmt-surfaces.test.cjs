'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  buildSurfaceUrl,
  resolveSurfaceUrl,
  resolvePersonalOverlayUrl,
} = require('../lib/spmt-surfaces.cjs');

function response(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  };
}

test('buildSurfaceUrl resolves canonical registry entries without a host-specific editor path', () => {
  const payload = { surfaces: [
    { id: 'worktray', path: '/embed/worktray' },
    { id: 'overlays', url: 'https://studio.example/overlay-editor' },
  ] };
  assert.equal(
    buildSurfaceUrl(payload, 'worktray', 'companion'),
    'https://spmt.live/embed/worktray?app=companion&mode=panel',
  );
  assert.equal(
    buildSurfaceUrl(payload, 'overlays', 'companion'),
    'https://studio.example/overlay-editor?app=companion&mode=full&output=personal',
  );
});

test('resolver uses the Electron session fetch contract for registry and Personal launch', async () => {
  const calls = [];
  const session = {
    fetch: async (url, init) => {
      calls.push({ url, init });
      if (String(url).endsWith('/api/platform/surfaces')) {
        return response([{ id: 'settings', path: '/embed/settings' }]);
      }
      if (String(url).endsWith('/api/personal-overlay-launch')) {
        return response({ url: 'https://spmt.live/tenant/tester/personal#render=secret' });
      }
      return response({ error: 'not found' }, 404);
    },
  };

  assert.equal(
    await resolveSurfaceUrl(session, 'settings', 'companion'),
    'https://spmt.live/embed/settings?app=companion&mode=full',
  );
  assert.equal(
    await resolvePersonalOverlayUrl(session),
    'https://spmt.live/tenant/tester/personal#render=secret',
  );
  assert.equal(calls.length, 2);
  assert.ok(calls.every((call) => call.init.credentials === 'include'));
  assert.ok(calls.every((call) => call.init.cache === 'no-store'));
});

test('Companion tracks canonical surfaces directly and keeps StreamWeaver on the authenticated wrapper', () => {
  const root = path.resolve(__dirname, '..');
  const main = fs.readFileSync(path.join(root, 'main.cjs'), 'utf8');
  const ui = fs.readFileSync(path.join(root, 'ui', 'index.html'), 'utf8');
  const renderer = fs.readFileSync(path.join(root, 'ui', 'renderer.js'), 'utf8');
  const config = fs.readFileSync(path.join(root, 'lib', 'config-store.cjs'), 'utf8');

  assert.match(main, /resolveSurfaceUrl/);
  assert.match(main, /resolvePersonalOverlayUrl/);
  assert.match(main, /refreshCanonicalPersonalOverlay/);
  assert.match(main, /trustManagedUrl/);
  assert.match(main, /action === 'spmt\.worktray'/);
  assert.match(main, /action === 'spmt\.settings'/);
  assert.match(main, /action === 'spmt\.overlays'/);
  assert.match(main, /COMPANION_WORKSPACE_URL = 'https:\/\/spacemountain\.live\/\?companionWorkspace=streamweaver'/);
  assert.match(main, /function showSpmtSurface/);
  assert.match(main, /function showWorkspace/);
  assert.doesNotMatch(main, /function showWorkspace\(\) \{\s*return showSpmtSurface\('worktray'\)/);
  assert.doesNotMatch(main, /https:\/\/spmt\.live\/embed\/(worktray|settings|overlays)/);

  assert.doesNotMatch(ui, /id="overlay-url"/);
  assert.match(ui, /overlay-source-status/);
  assert.doesNotMatch(renderer, /byId\('overlay-url'\)/);
  assert.match(config, /schemaVersion: 6/);
  assert.match(config, /overlay:\s*\{[\s\S]*?url: ''/);
  assert.match(config, /includes\('desktopOverlay=1'\)[\s\S]*?stored\.windows\.overlay\.url = ''/);
  assert.doesNotMatch(config, /url:\s*'https:\/\/spacemountain\.live\/\?desktopOverlay=1'/);
  assert.match(config, /https:\/\/spacemountain\.live\/\?companionWorkspace=streamweaver/);
});
