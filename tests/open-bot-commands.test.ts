import test from 'node:test';
import assert from 'node:assert/strict';

import { detectOpenBotCommand, runOpenBotCommand } from '../src/services/open-bot-commands';

test('detects safe natural-language commands after any tenant bot wake name', () => {
  assert.equal(detectOpenBotCommand("NovaBot, who's live?"), 'live-members');
  assert.equal(detectOpenBotCommand('athena whos live right now?'), 'live-members');
  assert.equal(detectOpenBotCommand('Athena who has the tag?'), 'chat-tag-current');
  assert.equal(detectOpenBotCommand('MayaBot, show me the ChatTag leaderboard'), 'chat-tag-leaderboard');
  assert.equal(detectOpenBotCommand("what's playing in HearMeOut?"), 'hearmeout');
  assert.equal(detectOpenBotCommand('tell me a joke'), null);
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
