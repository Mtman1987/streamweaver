import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const dispatcher = fs.readFileSync(path.join(process.cwd(), 'src/services/chat-dispatcher.ts'), 'utf8');
const actions = fs.readFileSync(path.join(process.cwd(), 'src/services/hearmeout-actions.ts'), 'utf8');

test('SML !sr and !wr bypass imported command actions and hit HearMeOut first', () => {
  const selfGuard = dispatcher.indexOf('if (self || isTheCountAccountMessage) return;');
  const media = dispatcher.indexOf('const smlMediaRequest = tenantId === SPACEMOUNTAIN_SYSTEM_TENANT_ID');
  const generic = dispatcher.indexOf('if (isCommand && (!isBot || isSpaceMountainBroadcasterCommand))');
  assert.ok(selfGuard >= 0);
  assert.ok(media > selfGuard);
  assert.ok(generic > media);
  assert.match(dispatcher, /system-spacemountainlive-lounge/);
  assert.match(dispatcher, /lane = command === 'wr' \? 'movie' : 'music'/);
  assert.doesNotMatch(dispatcher, /const sessionId = command === 'sr' \? 'discord-music-room' : 'discord-watch-room'/);
  assert.match(dispatcher, /action: 'hmo\.media\.request'/);
  assert.match(dispatcher, /HearMeOut could not queue/);
});


test('SML !sr and !wr write directly to the canonical Apollo Lounge player path', () => {
  assert.match(actions, /APOLLO_LOUNGE_ORIGIN/);
  assert.match(actions, /\/api\/watch\/broadcast\/requests\?roomId=/);
  assert.match(actions, /system-spacemountainlive-lounge/);
  assert.match(actions, /body: JSON\.stringify\(\{ query, lane, displayName: actorName \}\)/);
  assert.match(actions, /programRoomId/);
});


test('SML Twitch media does not mint a service token for the public Lounge request path', () => {
  const start = actions.indexOf("if (payload.action === 'hmo.media.request')");
  const end = actions.indexOf("const args: Record<string, string>", start);
  const requestBlock = actions.slice(start, end);
  assert.doesNotMatch(requestBlock, /getSpmtServiceToken/);
  assert.doesNotMatch(requestBlock, /Authorization:/);
});
