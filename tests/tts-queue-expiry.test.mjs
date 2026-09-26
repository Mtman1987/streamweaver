import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/app/api/tts/current/route.ts', import.meta.url), 'utf8');
const start = source.indexOf('const TTS_MAX_AGE_MS =');
const end = source.indexOf('\nfunction getTtsStateMap()', start);
const executable = stripTypeScriptTypes(source.slice(start, end) +
  '\nglobalThis.recentTtsItemsForTest = recentTtsItems;', { mode: 'strip' });
const context = { Date, Number };
vm.runInNewContext(executable, context);

test('speech from days ago expires while a new turn remains available', () => {
  const now = Date.parse('2026-09-26T02:05:00Z');
  const items = [
    { cursor: 'old', addedAt: '2026-09-20T03:32:21Z' },
    { cursor: 'recent', addedAt: '2026-09-26T02:04:30Z' },
  ];
  const result = context.recentTtsItemsForTest(items, now);
  assert.deepEqual(result.map(item => item.cursor), ['recent']);
});

test('invalid timestamps and expired clips cannot fill the twenty-item window', () => {
  const now = Date.parse('2026-09-26T02:05:00Z');
  const items = [{ cursor: 'bad', addedAt: 'invalid' }];
  for (let index = 0; index < 30; index++) items.push({
    cursor: String(index),
    addedAt: new Date(now - 30_000).toISOString(),
  });
  const result = context.recentTtsItemsForTest(items, now);
  assert.equal(result.length, 20);
  assert.equal(result[0].cursor, '10');
});
