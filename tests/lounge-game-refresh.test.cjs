const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
test('the live lounge refresh waits for the media request prompt and stays stable afterwards', async () => {
  let now = Date.now(), ready = false, overlays = false, requests = 0;
  const source = fs.readFileSync('src/app/api/lounge/browser-refresh/route.ts', 'utf8');
  const previous = Date.parse(source.match(/PREVIOUS_REFRESH_AT = Date.parse\('([^']+)'/)[1]);
  const current = Date.parse(source.match(/FORCE_REFRESH_AT = Date.parse\('([^']+)'/)[1]);
  const exports = {};
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, {
    exports, Date: { now: () => now, parse: Date.parse }, AbortSignal,
    require(name) {
      if (name === 'next/server') return { NextResponse: { json: value => ({ ...value, headers: { set() {} } }) } };
      if (name === '@/services/lounge-player-control') return { getLoungeBrowserRefresh: async () => ({ requestedAt: 0 }) };
      throw Error(name);
    },
    fetch: async url => { requests++; return { ok: url.includes('hearmeout') ? ready : overlays, text: async () => 'data-empty-request-prompt="v3" spmt-commercial-ready data-chat-tag-rotation="full-size-v2"' }; },
  });
  assert.equal((await exports.GET()).requestedAt, previous);
  assert.equal((await exports.GET()).requestedAt, previous);
  assert.equal(requests, 1);
  now += 10001; ready = true;
  assert.equal((await exports.GET()).requestedAt, previous, 'do not reload into a mixed overlay deployment');
  now += 10001; overlays = true;
  assert.equal((await exports.GET()).requestedAt, current);
  now += 10001;
  assert.equal((await exports.GET()).requestedAt, current);
  assert.equal(requests, 7, 'successful readiness is cached, so a request cannot cause a reload loop');
});
