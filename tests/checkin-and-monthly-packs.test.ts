import test from 'node:test';
import assert from 'node:assert/strict';
import { discordCheckinNames, includeRequiredSpaceMountainChatters } from '../src/services/checkin-sources';
import { formatSetList } from '../src/services/pokemon-packs';
import { FRONT_SEAT_BONUS_POINTS } from '../src/services/checkin-flow';

test('Space Mountain membership matching includes linked Twitch and Discord names', () => {
  const names = discordCheckinNames([
    {
      id: '1',
      discordUserId: '1',
      username: 'DiscordName',
      displayName: 'Display Name',
      twitchLogin: 'twitch_name',
      avatarUrl: '',
      group: 'Community',
    },
  ]);
  assert.deepEqual([...names].sort(), ['discordname', 'display name', 'twitch_name']);
});

test('Space Mountain candidates retain the invoking chatter and broadcaster', () => {
  const chatters = includeRequiredSpaceMountainChatters(
    [{ login: 'viewer_one', name: 'Viewer_One', userId: '1' }],
    'nephalem2',
    { username: 'MotherMayrien', userId: '26' },
  );

  assert.deepEqual(
    chatters.map((chatter) => chatter.login).sort(),
    ['mothermayrien', 'nephalem2', 'viewer_one'],
  );
});

test('Space Mountain candidates do not duplicate actor or broadcaster returned by Twitch', () => {
  const chatters = includeRequiredSpaceMountainChatters(
    [
      { login: 'nephalem2', name: 'Nephalem2', userId: '2' },
      { login: 'mothermayrien', name: 'MotherMayrien', userId: '26' },
    ],
    'NEPHALEM2',
    { username: 'MotherMayrien', userId: '26' },
  );

  assert.equal(chatters.length, 2);
});

test('monthly pack viewer mapping remains dynamic', () => {
  assert.equal(formatSetList({
    1: { code: 'one', name: 'First' },
    2: { code: 'two', name: 'Second' },
    3: { code: 'three', name: 'Third' },
    4: { code: 'four', name: 'Fourth' },
    5: { code: 'five', name: 'Fifth' },
    6: { code: 'six', name: 'Sixth' },
  }), 'PokePacks: 1.First 2.Second 3.Third 4.Fourth 5.Fifth 6.Sixth');
});

test('Space Mountain front seat awards 100 points', () => {
  assert.equal(FRONT_SEAT_BONUS_POINTS, 100);
});
