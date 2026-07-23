import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalSayStreamKey } from '../src/app/api/say/_stream';

test('canonicalSayStreamKey preserves Discord room streams', () => {
  assert.equal(
    canonicalSayStreamKey('Discord:1529889646727659701'),
    'discord:1529889646727659701'
  );
});

test('canonicalSayStreamKey normalizes Twitch room streams', () => {
  assert.equal(canonicalSayStreamKey('twitch:#Mtman1987'), 'twitch:mtman1987');
});

test('canonicalSayStreamKey maps a legacy tenant link to its Twitch room', () => {
  assert.equal(canonicalSayStreamKey('94371378', 'Mtman1987'), 'twitch:mtman1987');
});
