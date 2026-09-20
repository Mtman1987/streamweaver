import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

function source(relativePath: string) {
  return readFileSync(fileURLToPath(new URL(`../${relativePath}`, import.meta.url)), 'utf8');
}

test('SpaceMountainLive !sr and !wr route to the canonical lounge sessions', () => {
  const dispatcher = source('src/services/chat-dispatcher.ts');
  assert.match(dispatcher, /actualMessage\.match\(\/\^!\(sr\|wr\)/);
  assert.match(dispatcher, /roomId = 'system-spacemountainlive-lounge'/);
  assert.match(dispatcher, /sessionId = `watch-room-\$\{roomId\}-\$\{mediaKind\}`/);
  assert.match(dispatcher, /executeHearMeOutBotAction\(\{/);
  assert.match(dispatcher, /mediaKind,/);
});

test('lounge requests keep writes behind HearMeOut service authentication', () => {
  const client = source('src/services/hearmeout-actions.ts');
  assert.match(client, /Authorization: `Bearer \$\{secret\}`/);
  assert.match(client, /mediaKind\?: 'music' \| 'movie'/);
});
