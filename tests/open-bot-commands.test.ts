import test from 'node:test';
import assert from 'node:assert/strict';

import {
  detectOpenBotCommand,
  detectOpenBotCommandWithAi,
  rewriteSpmtNamespaceCommand,
  runOpenBotCommand,
} from '../src/services/open-bot-commands';

test('detects safe natural-language commands after any tenant bot wake name', () => {
  assert.equal(detectOpenBotCommand("NovaBot, who's live?"), 'live-members');
  assert.equal(detectOpenBotCommand('athena whos live right now?'), 'live-members');
  assert.equal(detectOpenBotCommand('how many users are reporting live in Chat-Tag?'), 'live-members');
  assert.equal(detectOpenBotCommand('MayaBot who has the tag?'), 'chat-tag-current');
  assert.equal(detectOpenBotCommand('MayaBot, show me the ChatTag leaderboard'), 'chat-tag-leaderboard');
  assert.equal(detectOpenBotCommand("what's playing in HearMeOut?"), 'hearmeout');
  assert.equal(detectOpenBotCommand('tell me a joke'), null);
});

test('routes explicit SPMT command namespace before conversational chat', () => {
  assert.equal(detectOpenBotCommand('spmt status'), 'chat-tag-status');
  assert.equal(detectOpenBotCommand('spmt sttus'), 'chat-tag-status');
  assert.equal(detectOpenBotCommand('@spmt status'), 'chat-tag-status');
  assert.equal(detectOpenBotCommand('SPMT current'), 'chat-tag-current');
  assert.equal(detectOpenBotCommand('spmt leaderboard'), 'chat-tag-leaderboard');
  assert.equal(detectOpenBotCommand('spmt live'), 'live-members');
  assert.equal(detectOpenBotCommand('spmt apps'), 'apps');
  assert.equal(detectOpenBotCommand('spmt music'), 'hearmeout');
  assert.equal(detectOpenBotCommand('spmt commands'), 'help');
  assert.equal(detectOpenBotCommand('spmt tell me a joke'), null);
});

test('rewrites documented SPMT namespace commands for the native DM dispatcher', () => {
  assert.equal(rewriteSpmtNamespaceCommand('spmt points'), '!points');
  assert.equal(rewriteSpmtNamespaceCommand('@spmt !pack'), '!pack');
  assert.equal(rewriteSpmtNamespaceCommand('NovaBot, how are you?'), null);
});

test('formats canonical SPMT live-member data without service secrets', async () => {
  const reply = await runOpenBotCommand('live-members', async (input) => {
    assert.match(String(input), /spmt\.live\/api\/community\/shoutouts/);
    return new Response(JSON.stringify({
      shoutouts: [
        { twitchDisplayName: 'StreamerOne', isLive: true },
        { twitchUsername: 'streamer_two', isLive: true },
        { twitchUsername: 'offline_user', isLive: false },
      ],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  });

  assert.equal(reply, '🟢 2 live: StreamerOne, streamer_two.');
});

test('falls back to public ChatTag roster and Twitch lookup when SPMT live feed is unavailable', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetcher = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });

    if (url.includes('/api/community/shoutouts')) {
      return new Response(JSON.stringify({ error: 'temporarily unavailable' }), { status: 503 });
    }
    if (url.endsWith('/api/tag')) {
      return new Response(JSON.stringify({
        players: [
          { twitchUsername: 'streamer_one' },
          { twitchUsername: 'streamer_two' },
        ],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.endsWith('/api/twitch/live')) {
      assert.equal(init?.method, 'POST');
      assert.deepEqual(JSON.parse(String(init?.body || '{}')), {
        usernames: ['streamer_one', 'streamer_two'],
      });
      return new Response(JSON.stringify({
        liveUsers: [{ displayName: 'Streamer One', username: 'streamer_one' }],
        allUsers: [],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response('{}', { status: 404 });
  };

  const reply = await runOpenBotCommand('live-members', fetcher as typeof fetch);
  assert.equal(reply, '🟢 1 live: Streamer One.');
  assert.equal(calls.some((call) => call.url.endsWith('/api/twitch/live')), true);
  assert.equal(calls.some((call) => new Headers(call.init?.headers).has('x-bot-secret')), false);
});

test('uses SPMT integration state for current IT without service-secret headers', async () => {
  const reply = await runOpenBotCommand('chat-tag-current', async (input, init) => {
    assert.match(String(input), /spmt\.live\/api\/integrations\/chat-tag\/state/);
    assert.equal(new Headers(init?.headers).has('x-bot-secret'), false);
    return new Response(JSON.stringify({
      currentIt: 'captain',
      players: [{ twitchUsername: 'captain', isIt: true, isActive: true, score: 50 }],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  assert.equal(reply, '🏷️ captain is currently IT in ChatTag.');
});

test('uses shared local-first AI inference when wording is not an exact match', async () => {
  const command = await detectOpenBotCommandWithAi(
    'NovaBot, can you see which of our people are broadcasting tonight?',
    'tenant-a',
    async () => 'live-members',
  );
  assert.equal(command, 'live-members');
});

test('keeps ordinary conversation out of the action layer', async () => {
  const command = await detectOpenBotCommandWithAi(
    'NovaBot, how has your evening been?',
    'tenant-a',
    async () => 'none',
  );
  assert.equal(command, null);
});

test('accepts an unambiguous action id prefix when the provider truncates output', async () => {
  const command = await detectOpenBotCommandWithAi(
    'Which members are broadcasting?',
    'tenant-a',
    async () => 'live-',
  );
  assert.equal(command, 'live-members');
});

test('keeps ChatTag status commands read-only and deterministic', async () => {
  const fetcher = async () => new Response(JSON.stringify({
    players: [
      { twitchUsername: 'captain', score: 50, isIt: true, isActive: true },
      { twitchUsername: 'crew', score: 25, isIt: false, isActive: false },
    ],
  }), { status: 200, headers: { 'content-type': 'application/json' } });

  assert.equal(await runOpenBotCommand('chat-tag-current', fetcher), '🏷️ captain is currently IT in ChatTag.');
  assert.equal(await runOpenBotCommand('chat-tag-status', fetcher), 'ChatTag has 2 players, with 1 currently active.');
  assert.match(await runOpenBotCommand('chat-tag-leaderboard', fetcher), /#1 captain \(50 pts\)/);
});
