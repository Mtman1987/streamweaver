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
  const signals = [];
  class Clock extends Date { static now() { return now; } }
  const code = stripTypeScriptTypes(source);
  const api = vm.runInNewContext(code + '\n({GET})', {
    process: { env: {} }, Date: Clock, Promise,
    NextResponse: { json: (value) => value },
    fetch: fetcher,
    AbortSignal: { timeout: (ms) => {
      deadlines.push(ms);
      const controller = new AbortController();
      signals.push(controller);
      return controller.signal;
    } },
  });
  return { ...api, deadlines, signals, advance: (ms) => { now += ms; } };
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
  api.signals.slice(4).forEach(c => c.abort());
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
  api.signals.slice(4).forEach(c => c.abort());
  const value = await result;
  assert.ok(Array.isArray(value.games));
  assert.equal(returned, true);
});
