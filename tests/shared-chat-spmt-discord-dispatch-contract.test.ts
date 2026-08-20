import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const route = readFileSync(
  path.resolve(process.cwd(), 'src/app/api/shared-chat/spmt-dispatch/route.ts'),
  'utf8',
);

test('SPMT Commlink dispatch canonicalizes legacy Discord channel ids', () => {
  assert.match(route, /function canonicalDestinationChannelId/);
  assert.match(route, /raw\.replace\(\/\^discord:\/i, ''\)/);
  assert.match(route, /canonicalDestinationChannelId\('discord', input\.destination\.channelId\)/);
});

test('Discord destination validation trusts the tenant-scoped unique channel id over stale labels', () => {
  assert.match(route, /function destinationMatchesEvent/);
  assert.match(route, /if \(destination\.platform === 'discord'\) return true/);
  assert.match(route, /eventChannelId !== destinationChannelId/);
});

test('Discord compose and delete both use the raw provider channel id', () => {
  const canonicalCalls = route.match(/canonicalDestinationChannelId\('discord', input\.destination\.channelId\)/g) || [];
  assert.ok(canonicalCalls.length >= 2, 'expected Discord compose and delete to canonicalize the channel id');
  assert.doesNotMatch(route, /sendDiscordMessage\(input\.destination\.channelId/);
  assert.doesNotMatch(route, /deleteDiscordMessage\(input\.destination\.channelId/);
});
