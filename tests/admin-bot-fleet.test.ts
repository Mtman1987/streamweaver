import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(
  new URL('../src/app/api/admin/tenants/route.ts', import.meta.url),
  'utf8',
);

test('admin tenant inventory separates broadcaster authorization from dedicated bot identity', () => {
  assert.match(source, /hasBroadcasterToken/);
  assert.match(source, /hasBotToken/);
  assert.match(source, /community-fallback/);
  assert.match(source, /effectiveBotName/);
  assert.match(source, /fallbackBotName/);
});

test('admin tenant inventory explains command capability source without exposing token values', () => {
  assert.match(source, /clip:\s*hasBroadcasterToken\s*\?\s*'broadcaster-oauth'/);
  assert.match(source, /channelManagement:\s*hasBroadcasterToken\s*\?\s*'broadcaster-oauth'/);
  assert.match(source, /customBotIdentity:\s*hasBotToken/);
  assert.match(source, /runtimePersonalityVersion/);
  assert.doesNotMatch(source, /broadcasterToken\s*[:,]\s*tokens\.broadcasterToken/);
  assert.doesNotMatch(source, /botToken\s*[:,]\s*tokens\.botToken/);
});
