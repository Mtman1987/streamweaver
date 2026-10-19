import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getAdminTwitchId,
  SPACEMOUNTAIN_SYSTEM_TENANT_ID,
  SPACEMOUNTAIN_SYSTEM_TWITCH_CHANNEL,
} from '../src/lib/tenant';
import {
  handleSpaceMountainGoLiveMessage,
  isAuthorizedSpaceMountainGoLive,
  isSpaceMountainGoLiveCommand,
  type SpaceMountainGoLiveResult,
} from '../src/services/spacemountain-golive';

const ownerInput = {
  message: '!golive',
  channel: `#${SPACEMOUNTAIN_SYSTEM_TWITCH_CHANNEL}`,
  tenantId: SPACEMOUNTAIN_SYSTEM_TENANT_ID,
  username: 'mtman1987',
  userId: getAdminTwitchId(),
  self: false,
  mirrored: false,
  botAuthored: false,
};

test('recognizes only the exact !golive command in the SpaceMountainLive channel', () => {
  assert.equal(isSpaceMountainGoLiveCommand('!golive', 'spacemountainlive'), true);
  assert.equal(isSpaceMountainGoLiveCommand(' !GOLIVE ', '#SPACEMOUNTAINLIVE'), true);
  assert.equal(isSpaceMountainGoLiveCommand('!golive please', 'spacemountainlive'), false);
  assert.equal(isSpaceMountainGoLiveCommand('!golive', 'anotherchannel'), false);
});

test('requires the configured immutable owner Twitch ID plus owner login and direct channel', () => {
  assert.equal(isAuthorizedSpaceMountainGoLive(ownerInput), true);
  assert.equal(isAuthorizedSpaceMountainGoLive({ ...ownerInput, username: 'moderator' }), false);
  assert.equal(isAuthorizedSpaceMountainGoLive({ ...ownerInput, userId: '123456789' }), false);
  assert.equal(isAuthorizedSpaceMountainGoLive({ ...ownerInput, tenantId: 'another-tenant' }), false);
  assert.equal(isAuthorizedSpaceMountainGoLive({ ...ownerInput, self: true }), false);
  assert.equal(isAuthorizedSpaceMountainGoLive({ ...ownerInput, mirrored: true }), false);
  assert.equal(isAuthorizedSpaceMountainGoLive({ ...ownerInput, botAuthored: true }), false);
});

test('unauthorized !golive attempts in the SpaceMountainLive chat are silently consumed', async () => {
  let starts = 0;
  const replies: string[] = [];
  const handled = await handleSpaceMountainGoLiveMessage(
    { ...ownerInput, username: 'friendlymoderator', userId: '777', moderator: true } as typeof ownerInput,
    {
      start: async () => { starts += 1; return { ok: true, state: 'live' }; },
      reply: async (message) => { replies.push(message); },
    },
  );
  assert.equal(handled, true);
  assert.equal(starts, 0);
  assert.deepEqual(replies, []);
});

test('does not invoke the control service for unrelated messages', async () => {
  let starts = 0;
  const handled = await handleSpaceMountainGoLiveMessage(
    { ...ownerInput, message: '!status' },
    {
      start: async () => { starts += 1; return { ok: true, state: 'live' }; },
      reply: async () => undefined,
    },
  );
  assert.equal(handled, false);
  assert.equal(starts, 0);
});

test('login-required result never claims success and keeps the browser snapshot private', async () => {
  const replies: string[] = [];
  const loginRequired: SpaceMountainGoLiveResult = { ok: false, state: 'login_required' };
  await handleSpaceMountainGoLiveMessage(ownerInput, {
    start: async () => loginRequired,
    reply: async (message) => { replies.push(message); },
  });
  assert.equal(replies.length, 2);
  assert.match(replies[1], /sign in in the saved Studio browser/i);
  assert.match(replies[1], /not reported success/i);
  assert.doesNotMatch(replies.join(' '), /snapshot|Bearer |access_token|refresh_token/i);
});

test('only an explicit verified live state is reported as success', async () => {
  const failedReplies: string[] = [];
  await handleSpaceMountainGoLiveMessage(ownerInput, {
    start: async () => ({ ok: false, state: 'live' }),
    reply: async (message) => { failedReplies.push(message); },
  });
  assert.match(failedReplies[1], /could not verify Twitch live status/i);
  assert.doesNotMatch(failedReplies[1], /Twitch confirms .* is live/i);

  const successReplies: string[] = [];
  await handleSpaceMountainGoLiveMessage(ownerInput, {
    start: async () => ({ ok: true, state: 'live', verifiedAt: new Date().toISOString() }),
    reply: async (message) => { successReplies.push(message); },
  });
  assert.match(successReplies[1], /Twitch confirms SpaceMountainLive is live/i);
});
