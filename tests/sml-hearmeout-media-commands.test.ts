import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const dispatcher = fs.readFileSync(path.join(process.cwd(), 'src/services/chat-dispatcher.ts'), 'utf8');
const actions = fs.readFileSync(path.join(process.cwd(), 'src/services/hearmeout-actions.ts'), 'utf8');

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
  assert.doesNotMatch(dispatcher, /const sessionId = command === 'sr' \? 'discord-music-room' : 'discord-watch-room'/);
  assert.match(dispatcher, /action: 'hmo\.media\.request'/);
  assert.match(dispatcher, /HearMeOut could not queue/);
});


test('SML media commands route to the canonical live HearMeOut queue owner', () => {
  assert.match(actions, /function liveHearMeOutPayload/);
  assert.match(actions, /sessionId: SPACEMOUNTAIN_LOUNGE_SESSION_ID/);
  assert.match(actions, /fetch\(\`\$\{HEARMEOUT_URL\}\/api\/internal\/bot\/actions\`/);
  assert.match(actions, /isPublicLoungeQueueAction/);
  assert.match(actions, /effectivePayload\.action === 'hmo\.media\.request'/);
  assert.match(actions, /effectivePayload\.action === 'hmo\.media\.state\.read'/);
  assert.match(actions, /\.\.\.\(secret \? \{ Authorization: \`Bearer \$\{secret\}\` \} : \{\}\)/);
  assert.doesNotMatch(actions, /APOLLO_LOUNGE_ORIGIN|\/api\/watch\/broadcast\/requests\?roomId=|executeSpaceMountainApolloMedia/);
});

test('only Lounge queue/read bypass the shared secret; controls stay protected', () => {
  assert.match(actions, /isPublicLoungeQueueAction = isSpaceMountainLoungeMedia\(effectivePayload\)/);
  assert.match(actions, /!isPublicLoungeQueueAction && !secrets\.length/);
  assert.match(actions, /!isPublicLoungeQueueAction && response\.status === 401/);
});

test('SML media commands do not use the SPMT job queue or Apollo as a second queue owner', () => {
  assert.doesNotMatch(actions, /getSpmtServiceToken|SPMT_JOB_SCOPES|\/v1\/suite-actions|\/v1\/jobs\//);
});