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
  assert.equal(detectOpenBotCommand('how many users are reporting live in Chat-Tag?'), null);
  assert.equal(detectOpenBotCommand('who is streaming in ChatTag?'), null);
  assert.equal(detectOpenBotCommand('show Chat Tag live members'), null);
  assert.equal(detectOpenBotCommand('how many people are live right now?'), 'live-members');
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

test('uses DSH as the sole live-community source', async () => {
  const calls: string[] = [];
  const reply = await runOpenBotCommand('live-members', async (input) => {
    calls.push(String(input));
    assert.match(String(input), /discord-stream-hub-new\.fly\.dev\/api\/community-spotlight/);
    return new Response(JSON.stringify({
      source: 'discord-stream-hub',
      count: 2,
      users: [
        { username: 'StreamerOne', twitchLogin: 'streamer_one', group: 'Community' },
        { username: 'StreamerTwo', twitchLogin: 'streamer_two', group: 'Partners' },
      ],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  });

  assert.equal(reply, '🟢 DSH reports 2 SpaceMountain community members live right now: StreamerOne, StreamerTwo.');
  assert.equal(calls.length, 1);
  assert.equal(calls.some((url) => /chat-tag|api\/tag|api\/twitch\/live/.test(url)), false);
});

test('does not fall back to Chat Tag when DSH live-community state is unavailable', async () => {
  const calls: string[] = [];
  const reply = await runOpenBotCommand('live-members', async (input) => {
    calls.push(String(input));
    return new Response(JSON.stringify({ error: 'temporarily unavailable' }), { status: 503 });
  });

  assert.equal(reply, 'The Discord Stream Hub live-community list is temporarily unavailable, so I will not guess who is live.');
  assert.equal(calls.length, 1);
  assert.equal(calls.some((url) => /chat-tag|api\/tag|api\/twitch\/live/.test(url)), false);
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
  assert.equal(reply, '🏷️ captain currently has the active tag in Nebula Arcade.');
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

  assert.equal(await runOpenBotCommand('chat-tag-current', fetcher), '🏷️ captain currently has the active tag in Nebula Arcade.');
  assert.equal(await runOpenBotCommand('chat-tag-status', fetcher), 'Nebula Arcade has 2 players, with 1 currently active.');
  assert.match(await runOpenBotCommand('chat-tag-leaderboard', fetcher), /#1 captain \(50 pts\)/);
});
