import assert from 'node:assert/strict';
import test from 'node:test';
import { BRB_CHAT_ACTIVITY_WINDOW_MS, recentTwitchChatters } from '../src/services/brb-viewer-targets';

const now = Date.parse('2026-09-26T02:20:54Z');
const event = (login: string, overrides: Record<string, unknown> = {}) => ({
  platform: 'twitch',
  sourceName: 'spacemountainlive',
  sender: { login, roles: ['viewer'] },
  receivedTimestamp: new Date(now - 5_000).toISOString(),
  meta: { self: false },
  ...overrides,
});

test('BRB sees audience commands in the broadcaster channel without chatters OAuth', () => {
  const events = [
    event('mtman1987'),
    event('mtman1987'),
    event('someoneelse', { sourceName: 'mtman1987' }),
    event('oldviewer', { receivedTimestamp: new Date(now - BRB_CHAT_ACTIVITY_WINDOW_MS - 1).toISOString() }),
    event('stellabot87', { sender: { login: 'stellabot87', roles: ['bot'] } }),
    event('discorduser', { platform: 'discord' }),
    event('spacemountainlive', { meta: { self: true } }),
  ];
  assert.deepEqual(recentTwitchChatters(events as any, 'spacemountainlive', now), ['mtman1987']);
});
