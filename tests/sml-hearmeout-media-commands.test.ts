import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const dispatcher = fs.readFileSync(path.join(process.cwd(), 'src/services/chat-dispatcher.ts'), 'utf8');
const actions = fs.readFileSync(path.join(process.cwd(), 'src/services/hearmeout-actions.ts'), 'utf8');
const lounge = fs.readFileSync(path.join(process.cwd(), 'src/lib/spacemountain-lounge.ts'), 'utf8');

test('SML !sr and !wr bypass imported command actions and hit HearMeOut first', () => {
  const selfGuard = dispatcher.indexOf('if ((self && !isSpaceMountainBroadcasterCommand) || isTheCountAccountMessage) return;');
  const media = dispatcher.indexOf('const smlMediaRequest = tenantId === SPACEMOUNTAIN_SYSTEM_TENANT_ID');
  const generic = dispatcher.indexOf('if (isCommand && (!isBot || isSpaceMountainBroadcasterCommand))');
  assert.ok(selfGuard >= 0);
  assert.match(dispatcher, /self && !isSpaceMountainBroadcasterCommand/);
  assert.ok(media > selfGuard);
  assert.ok(generic > media);
  assert.match(dispatcher, /system-spacemountainlive-lounge/);
  assert.match(dispatcher, /lane = command === 'wr' \? 'movie' : 'music'/);
  assert.match(dispatcher, /action: 'hmo\.media\.request'/);
  assert.match(dispatcher, /HearMeOut could not queue/);
  assert.match(dispatcher, /TRACE !/);
  assert.match(dispatcher, /requestedRoomId/);
  assert.match(dispatcher, /actualRoomId/);
});

test('SML media keeps separate permanent music and movie sessions', () => {
  assert.match(lounge, /SPACEMOUNTAIN_LOUNGE_MUSIC_SESSION_ID/);
  assert.match(lounge, /SPACEMOUNTAIN_LOUNGE_MOVIE_SESSION_ID/);
  assert.match(actions, /lane === 'movie' \? SPACEMOUNTAIN_LOUNGE_MOVIE_SESSION_ID : SPACEMOUNTAIN_LOUNGE_MUSIC_SESSION_ID/);
  assert.match(actions, /sessionId === SPACEMOUNTAIN_LOUNGE_MOVIE_SESSION_ID/);
  assert.match(actions, /fetch\(\`\$\{HEARMEOUT_URL\}\/api\/internal\/bot\/actions\`/);
  assert.doesNotMatch(actions, /APOLLO_LOUNGE_ORIGIN|\/api\/watch\/broadcast\/requests\?roomId=|executeSpaceMountainApolloMedia/);
});

test('all SpaceMountain Lounge media bypass shared service and chat auth during development', () => {
  assert.match(actions, /bypassServiceAuthForLoungeMedia = isSpaceMountainLoungeMedia\(effectivePayload\)/);
  assert.match(actions, /const secrets = bypassServiceAuthForLoungeMedia \? \[\] : getHearMeOutServiceSecrets\(\)/);
  assert.match(actions, /!bypassServiceAuthForLoungeMedia && !secrets\.length/);
  assert.match(actions, /!bypassServiceAuthForLoungeMedia && response\.status === 401/);
  assert.match(dispatcher, /tenantId !== SPACEMOUNTAIN_SYSTEM_TENANT_ID && command !== 'play' && !canControlHearMeOut/);
});

test('SML media commands do not use the SPMT job queue or Apollo as a second queue owner', () => {
  assert.doesNotMatch(actions, /getSpmtServiceToken|SPMT_JOB_SCOPES|\/v1\/suite-actions|\/v1\/jobs\//);
});
