import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (p:string) => fs.readFileSync(p,'utf8');

test('Twitch Lounge commands and Lounge display share one canonical HMO session', () => {
  const constants = read('src/lib/spacemountain-lounge.ts');
  const actions = read('src/services/hearmeout-actions.ts');
  const dispatcher = read('src/services/chat-dispatcher.ts');
  const status = read('src/app/api/lounge/status-strip/route.ts');

  assert.match(constants, /SPACEMOUNTAIN_LOUNGE_ROOM_ID = 'system-spacemountainlive-lounge'/);
  assert.match(constants, /SPACEMOUNTAIN_LOUNGE_SESSION_ID = `watch-room-${SPACEMOUNTAIN_LOUNGE_ROOM_ID}-music`/);

  assert.match(dispatcher, /SPACEMOUNTAIN_LOUNGE_ROOM_ID/);
  assert.match(actions, /sessionId: SPACEMOUNTAIN_LOUNGE_SESSION_ID/);
  assert.match(status, /SPACEMOUNTAIN_LOUNGE_SESSION_ID/);
  assert.match(status, /\/api\/watch\/sessions\/\$\{encodeURIComponent\(SPACEMOUNTAIN_LOUNGE_SESSION_ID\)\}\/state/);

  assert.doesNotMatch(status, /apollo\/api\/watch\/broadcast\/state|apolloLoungeState/);
  assert.doesNotMatch(actions, /sessionId: lane === 'movie' \? SPACEMOUNTAIN_MOVIE_SESSION_ID : SPACEMOUNTAIN_MUSIC_SESSION_ID/);
});
