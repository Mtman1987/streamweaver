import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildStellaLoungeSnapshot,
  detectStellaLoungeIntent,
  formatStellaLoungeContext,
  resolveStellaLoungeIntent,
} from '../src/services/stella-lounge-host';

test('detects Stella host questions and social gestures', () => {
  assert.equal(detectStellaLoungeIntent("Stella, what's happening in the Lounge?"), 'overview');
  assert.equal(detectStellaLoungeIntent('how can I join the game?'), 'join-game');
  assert.equal(detectStellaLoungeIntent("what's playing right now?"), 'playing');
  assert.equal(detectStellaLoungeIntent("who's live in the Spotlight right now?"), 'live');
  assert.equal(detectStellaLoungeIntent('I need a moderator'), 'moderator');
  assert.equal(detectStellaLoungeIntent('fist bump, Stella'), 'fist-bump');
  assert.equal(detectStellaLoungeIntent('what did you think of that book?'), null);
});

function fixtureFetch(input: string | URL | Request): Promise<Response> {
  const url = String(input);
  if (url.includes('/lounge/media/program')) {
    return Promise.resolve(new Response(JSON.stringify({
      movie: { current: null, playback: { status: 'idle' }, queue: [], queueCount: 0 },
      music: { current: { item: { title: 'Rocket Man', artist: 'Elton John' } }, playback: { status: 'playing' }, queue: [], queueCount: 2 },
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
  }
  if (url.includes('/spotlight/program')) return Promise.resolve(new Response(JSON.stringify({ ready: true, currentLogin: 'CaptainOne' }), { status: 200 }));
  if (url.includes('/api/integrations/chat-tag/state') || url.endsWith('/api/tag')) {
    return Promise.resolve(new Response(JSON.stringify({
      currentIt: 'Nova',
      players: [
        { username: 'Nova', isIt: true, isActive: true },
        { username: 'Orion', isActive: false },
      ],
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
  }
  if (url.includes('/api/game-hub/channel')) {
    return Promise.resolve(new Response(JSON.stringify({
      games: [{ id: 'bingo', shortName: 'Bingo', playerCommands: [{ trigger: '!bingo join' }] }],
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
  }
  if (url.includes('/api/community/shoutouts')) {
    return Promise.resolve(new Response(JSON.stringify({
      shoutouts: [
        { twitchDisplayName: 'CaptainOne', isLive: true },
        { twitchDisplayName: 'CaptainTwo', isLive: false },
      ],
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
  }
  return Promise.resolve(new Response('{}', { status: 404 }));
}

test('builds one bounded snapshot from the live services', async () => {
  const snapshot = await buildStellaLoungeSnapshot(fixtureFetch as typeof fetch, Date.parse('2026-09-21T12:00:00Z'));
  assert.equal(snapshot.media.currentTitle, 'Rocket Man');
  assert.equal(snapshot.media.queueCount, 2);
  assert.equal(snapshot.overlay.spotlight, 'CaptainOne');
  assert.equal(snapshot.nebula.playerCount, 2);
  assert.equal(snapshot.nebula.activePlayerCount, 1);
  assert.equal(snapshot.nebula.currentPlayer, 'Nova');
  assert.deepEqual(snapshot.nebula.games, [{ name: 'Bingo', joinCommand: '!bingo join' }]);
  assert.deepEqual(snapshot.community.liveNames, ['CaptainOne']);
  const prompt = formatStellaLoungeContext(snapshot);
  assert.match(prompt, /Rocket Man by Elton John/);
  assert.match(prompt, /Nebula Arcade has 2 players/);
  assert.match(prompt, /Available now: Bingo/);
  assert.match(prompt, /spmt join/);
  assert.match(prompt, /!mtfixit/);
});

test('answers high-value Lounge questions from facts without a model guess', async () => {
  assert.equal(
    await resolveStellaLoungeIntent('playing', fixtureFetch as typeof fetch),
    'The Lounge music worker reports Rocket Man by Elton John playing.',
  );
  assert.match(await resolveStellaLoungeIntent('live', fixtureFetch as typeof fetch), /@CaptainOne on the Spotlight feed/);
  assert.match(await resolveStellaLoungeIntent('join-game', fixtureFetch as typeof fetch), /spmt join.*!bingo join/);
  assert.match(await resolveStellaLoungeIntent('game-status', fixtureFetch as typeof fetch), /Nova currently has the active turn/);
  assert.match(await resolveStellaLoungeIntent('overview', fixtureFetch as typeof fetch), /CaptainOne/);
  assert.match(await resolveStellaLoungeIntent('moderator', fixtureFetch as typeof fetch), /!mtfixit/);
  assert.match(await resolveStellaLoungeIntent('fist-bump', fixtureFetch as typeof fetch), /happy_gesture/);
});

test('reports a paused movie alongside playing music without saying the movie ended', async () => {
  const fetchPausedMovie = (input: string | URL | Request) => {
    if (String(input).includes('/lounge/media/program')) return Promise.resolve(new Response(JSON.stringify({
      movie: { current: { item: { title: 'The Fifth Element' } }, playback: { status: 'paused' }, queue: [] },
      music: { current: { item: { title: 'Rocket Man', artist: 'Elton John' } }, playback: { status: 'playing' }, queue: [] },
    }), { status: 200 }));
    return fixtureFetch(input);
  };
  const snapshot = await buildStellaLoungeSnapshot(fetchPausedMovie as typeof fetch);
  assert.equal(snapshot.media.kind, 'music');
  assert.equal(snapshot.media.pausedMovieTitle, 'The Fifth Element');
  assert.match(formatStellaLoungeContext(snapshot), /Rocket Man.*playing.*The movie The Fifth Element is selected but not playing/);
});
