import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const dispatcher = fs.readFileSync(path.join(process.cwd(), 'src/services/chat-dispatcher.ts'), 'utf8');

test('SML broadcaster commands bypass bot classification only in its own production channel', () => {
  assert.match(dispatcher, /const isSpaceMountainBroadcasterCommand/);
  assert.match(dispatcher, /tenantId === SPACEMOUNTAIN_SYSTEM_TENANT_ID/);
  assert.match(dispatcher, /replyChannel\.toLowerCase\(\) === 'spacemountainlive'/);
  assert.match(dispatcher, /actualUsername\.toLowerCase\(\) === 'spacemountainlive'/);
  assert.match(dispatcher, /if \(isCommand && \(!isBot \|\| isSpaceMountainBroadcasterCommand\)\)/);
});

test('SML exception does not remove bot classification used by non-command loop guards', () => {
  assert.match(dispatcher, /const isBot = actualUsername\.toLowerCase\(\) === \(botUsername \|\| ''\)\.toLowerCase\(\)/);
  assert.match(dispatcher, /if \(!isCommand && !isBotMessage && !isKnownAutomationBotMessage/);
});
