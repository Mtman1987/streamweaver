const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');
const source = fs.readFileSync('src/app/api/lounge/status-strip/route.ts', 'utf8')
  .replace("import { NextResponse } from 'next/server';", '')
  .replace(/export /g, '');
function setup(fetcher) {
  let now = 0; const deadlines = [];
  const timers = new Map(); let nextTimer = 0;
  class Clock extends Date { static now() { return now; } }
  const code = stripTypeScriptTypes(source);
  const api = vm.runInNewContext(code + '\n({GET})', {
    process: { env: {} }, Date: Clock, Promise,
    NextResponse: { json: (value) => value }, fetch: fetcher, AbortController,
    setTimeout: (callback, ms) => {
      deadlines.push(ms); const id = ++nextTimer; timers.set(id, callback); return id;
    },
    clearTimeout: id => timers.delete(id),
  });
  return { ...api, deadlines, expire: () => { for (const callback of [...timers.values()]) callback(); }, advance: (ms) => { now += ms; } };
}
const reply = (body = {}) => ({ok: true, status: 200, json: async () => body});
test('cold status shares four bounded upstream requests across concurrent callers', async () => {
  let count = 0;
  const api = setup(async () => { count++; return reply(); });
  await Promise.all([api.GET(), api.GET(), api.GET()]);
  assert.equal(count, 4);
  assert.equal(api.deadlines.length, 4);
  assert.ok(api.deadlines.every(ms => ms === 2000 && ms < 8000));
});
test('recent cached status returns without waiting for stalled refresh', async () => {
  let stall = false, count = 0;
  const api = setup(async (_url, options) => {
    count++;
    if (stall) return new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new Error('timeout')), {once: true});
    });
    return reply();
  });
  const first = await api.GET();
  stall = true; api.advance(3000);
  const value = await api.GET();
  assert.deepEqual(value, first);
  await api.GET(); assert.equal(count, 8);
  api.expire();
  await new Promise(resolve => setImmediate(resolve));
});
test('cache beyond the display age limit waits for a fresh bounded result', async () => {
  let stall = false, returned = false;
  const api = setup(async (_url, options) => {
    if (stall) return new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new Error('timeout')), {once: true});
    });
    return reply();
  });
  await api.GET();
  stall = true; api.advance(31000);
  const result = api.GET().then(value => { returned = true; return value; });
  await Promise.resolve();
  assert.equal(returned, false);
  api.expire();
  const value = await result;
  assert.ok(Array.isArray(value.games));
  assert.equal(returned, true);
});


test('cold request completes at its deadline even when fetch ignores abort', async () => {
  let count = 0;
  const api = setup(() => { count++; return new Promise(() => {}); });
  const result = api.GET();
  api.expire();
  const value = await result;
  assert.equal(count, 4);
  assert.ok(Array.isArray(value.games));
  api.advance(3000);
  await api.GET();
  assert.equal(count, 8, 'expired requests release the refresh single-flight');
  api.expire();
});
test('body parsing is included in the independent deadline', async () => {
  const api = setup(async () => ({ok: true, status: 200, json: () => new Promise(() => {})}));
  const result = api.GET();
  await Promise.resolve();
  api.expire();
  const value = await result;
  assert.ok(Array.isArray(value.events));
});
