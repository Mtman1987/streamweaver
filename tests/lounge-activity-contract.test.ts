import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

test('Twitch !leaderboard routes to the points leaderboard overlay', () => {
  const dispatcher = fs.readFileSync('src/services/chat-dispatcher.ts', 'utf8');
  assert.match(dispatcher, /'!leaderboard'.*'!pleader'/s);
  assert.match(dispatcher, /requestedCmd === '!leaderboard' \? '!pleader'/);
});

test('featured chat supports a visible latest-message fallback', () => {
  const route = fs.readFileSync('src/app/api/shared-chat/featured/route.ts', 'utf8');
  const overlay = fs.readFileSync('src/app/overlay/shared-chat-featured/page.tsx', 'utf8');
  assert.match(route, /fallbackToLatest/);
  assert.match(route, /replay\[replay\.length - 1\]/);
  assert.match(overlay, /Waiting for the next community message/);
});

test('command leaderboard fills the compact activity panel', () => {
  const overlay = fs.readFileSync('src/app/overlay/leaderboard/page.tsx', 'utf8');
  assert.match(overlay, /position: 'fixed', inset: 0/);
  assert.match(overlay, /15000/);
});

test('Lounge Stella is scaled down and lifted onto the lower panel edge', () => {
  const player = fs.readFileSync('src/app/tts-player/page.tsx', 'utf8');
  assert.match(player, /loungePlacement \? 210 : 300/);
  assert.match(player, /loungePlacement \? 92 : 0/);
  assert.match(player, /loungePlacement \? -12 : 0/);
});
