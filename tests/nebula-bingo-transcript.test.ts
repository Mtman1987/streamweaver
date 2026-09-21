import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

test('Voice Commander captures tab audio or microphone audio for shared Nebula Bingo', () => {
  const commander = fs.readFileSync('src/app/(app)/dashboard/voice-commander.tsx', 'utf8');
  const route = fs.readFileSync('src/app/api/nebula/bingo-transcript/route.ts', 'utf8');
  assert.match(commander, /Stream Bingo \{bingoListening \? 'listening' : 'off'\}/);
  assert.match(commander, /getDisplayMedia\(\{ video: true, audio: true \}\)/);
  assert.match(commander, /getUserMedia\(\{ audio: true \}\)/);
  assert.match(commander, /Share tab audio/);
  assert.match(commander, /transcribeAudio/);
  assert.match(commander, /\/api\/nebula\/bingo-transcript/);
  assert.match(route, /CHAT_TAG_BASE_URL/);
  assert.match(route, /\/api\/game-hub\/bingo-transcript/);
  assert.match(route, /x-bot-secret/);
  assert.match(route, /CHAT_TAG_SECRET/);
  assert.match(route, /getTenantFromRequest/);
  assert.match(route, /readUserConfig/);
});
