import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareStellaLoungeReply } from '../src/services/stella-lounge-replies';

test('Stella speaks conversational lounge replies even when the legacy call requested broadcaster', () => {
  assert.deepEqual(prepareStellaLoungeReply('@viewer, welcome back!', 'broadcaster'), {
    message: '@viewer, welcome back!', as: 'bot',
  });
});

test('links, machine receipts, and command lists stay with the broadcaster', () => {
  for (const text of [
    'Follow @friend: https://twitch.tv/friend',
    '✅ @viewer 24-Hour Lounge: Song — Queued up.',
    'Use !sr song title to request a song.',
    '1) First | 2) Second | Reply 1 or 2',
  ]) {
    assert.equal(prepareStellaLoungeReply(text, 'bot').as, 'broadcaster', text);
  }
});

test('exact numbers remain in chat parentheses while Stella gets a varied spoken lead', () => {
  const first = prepareStellaLoungeReply('@viewer has 240 points!', 'broadcaster');
  const next = prepareStellaLoungeReply('Volume set to 40%.', 'bot');
  assert.equal(first.as, 'bot');
  assert.match(first.message, /\(@viewer has 240 points!\)$/);
  assert.match(next.message, /\(Volume set to 40%\.\)$/);
  assert.notEqual(first.message.split('.')[0], next.message.split('.')[0]);
});
