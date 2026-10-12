import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

test('Bingo capture and stream sharing are removed while transcription is paused', () => {
  const commander = fs.readFileSync('src/app/(app)/dashboard/voice-commander.tsx', 'utf8');
  assert.doesNotMatch(commander, /getDisplayMedia|recordBingoChunk|listenForBingo|bingoSource|bingo-listen/);
  assert.match(commander, /Bingo transcription is off/);
});
test('Bingo forwarding rejects stale clients before making any upstream request', () => {
  const route = fs.readFileSync('src/app/api/nebula/bingo-transcript/route.ts', 'utf8');
  assert.match(route, /status: 410/);
  assert.doesNotMatch(route, /fetch\(|transcribeAudio|CHAT_TAG_SECRET/);
});
