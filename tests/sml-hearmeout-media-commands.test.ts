import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const dispatcher = fs.readFileSync(path.join(process.cwd(), 'src/services/chat-dispatcher.ts'), 'utf8');

test('SML !sr and !wr bypass imported command actions and hit HearMeOut first', () => {
  const selfGuard = dispatcher.indexOf('if (self || isTheCountAccountMessage) return;');
  const media = dispatcher.indexOf('const smlMediaRequest = tenantId === SPACEMOUNTAIN_SYSTEM_TENANT_ID');
  const generic = dispatcher.indexOf('if (isCommand && (!isBot || isSpaceMountainBroadcasterCommand))');
  assert.ok(selfGuard >= 0);
  assert.ok(media > selfGuard);
  assert.ok(generic > media);
  assert.match(dispatcher, /discord-music-room/);
  assert.match(dispatcher, /discord-watch-room/);
  assert.match(dispatcher, /action: 'hmo\.media\.request'/);
  assert.match(dispatcher, /HearMeOut could not queue/);
});
