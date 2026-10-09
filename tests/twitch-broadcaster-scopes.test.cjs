const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { NextRequest } = require('next/server');
const source = ts.transpileModule(fs.readFileSync('src/app/api/auth/twitch/route.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
function load() {
  const module = { exports: {} };
  const deps = {
    'next/server': require('next/server'),
    '@/lib/runtime-origin': { getOAuthRedirectUri: () => 'https://fixture/auth/twitch/callback' },
    '@/lib/tenant-context': { getTenantFromRequest: () => ({ tenantId: 'owner' }) },
    '@/lib/tenant': { isAdmin: id => id === 'owner' },
    '@/lib/twitch-privileged-oauth.server': {
      createPrivilegedTwitchOAuthTransaction: role => ({ state: 'fixture-' + role, cookieValue: 'fixture' }),
      TWITCH_PRIVILEGED_OAUTH_COOKIE: 'fixture-oauth', TWITCH_PRIVILEGED_OAUTH_MAX_AGE: 300,
    },
  };
  vm.runInNewContext(source, { module, exports: module.exports,
    require: id => { if (!(id in deps)) throw Error('Unexpected import ' + id); return deps[id]; },
    URL, Set, console: { info() {} }, process: { env: { TWITCH_CLIENT_ID: 'fixture' } },
  });
  return module.exports.GET;
}
test('broadcaster reconnect requests follower permission; bot and Count scopes stay unchanged', async () => {
  const get = load();
  for (const role of ['broadcaster', 'space-mountain-broadcaster', 'bot', 'community-bot', 'the-count', 'space-mountain-bot', 'login']) {
    const response = await get(new NextRequest('https://fixture/api/auth/twitch?role=' + role));
    assert.equal(response.status, 307);
    const url = new URL(response.headers.get('location'));
    const scopes = new Set(url.searchParams.get('scope').split(' '));
    assert.equal(scopes.has('moderator:read:followers'), role === 'broadcaster' || role === 'space-mountain-broadcaster');
    assert.equal(url.searchParams.get('force_verify'), 'true');
    assert.equal(url.searchParams.get('redirect_uri'), 'https://fixture/auth/twitch/callback');
    assert.equal(scopes.has('chat:read'), true);
    assert.equal(scopes.has('chat:edit'), true);
    if (role === 'the-count') assert.equal(scopes.has('channel:manage:broadcast'), false);
  }
});
