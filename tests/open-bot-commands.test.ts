import test from 'node:test';
import assert from 'node:assert/strict';

import {
  detectOpenBotCommand,
  detectOpenBotCommandWithAi,
  runOpenBotCommand,
} from '../src/services/open-bot-commands';

test('detects safe natural-language commands after any tenant bot wake name', () => {
  assert.equal(detectOpenBotCommand("NovaBot, who's live?"), 'live-members');
  assert.equal(detectOpenBotCommand('athena whos live right now?'), 'live-members');
  assert.equal(detectOpenBotCommand('Athena who has the tag?'), 'chat-tag-current');
  assert.equal(detectOpenBotCommand('MayaBot, show me the ChatTag leaderboard'), 'chat-tag-leaderboard');
  assert.equal(detectOpenBotCommand("what's playing in HearMeOut?"), 'hearmeout');
  assert.equal(detectOpenBotCommand('tell me a joke'), null);
});

test('routes explicit SPMT command namespace before conversational chat', () => {
  assert.equal(detectOpenBotCommand('spmt status'), 'chat-tag-status');
  assert.equal(detectOpenBotCommand('SPMT current'), 'chat-tag-current');
  assert.equal(detectOpenBotCommand('spmt leaderboard'), 'chat-tag-leaderboard');
  assert.equal(detectOpenBotCommand('spmt live'), 'live-members');
  assert.equal(detectOpenBotCommand('spmt apps'), 'apps');
  assert.equal(detectOpenBotCommand('spmt music'), 'hearmeout');
  assert.equal(detectOpenBotCommand('spmt commands'), 'help');
  assert.equal(detectOpenBotCommand('spmt tell me a joke'), null);
});

test('formats shared live-member data without tenant credentials', async () => {
  const reply = await runOpenBotCommand('live-members', async () => new Response(JSON.stringify({
    liveMembers: [
      { twitchDisplayName: 'StreamerOne' },
      { twitchUsername: 'streamer_two' },
    ],
  }), { status: 200, headers: { 'content-type': 'application/json' } }));

  assert.equal(reply, '🟢 2 live: StreamerOne, streamer_two.');
});

test('uses MountainView-style AI inference when wording is not an exact match', async () => {
  const command = await detectOpenBotCommandWithAi(
    'Athena, can you see which of our people are broadcasting tonight?',
    'tenant-a',
    async () => 'live-members',
  );

  assert.equal(command, 'live-members');
});

test('keeps ordinary conversation out of the action layer', async () => {
  const command = await detectOpenBotCommandWithAi(
    'Athena, how has your evening been?',
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
