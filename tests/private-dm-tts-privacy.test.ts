import assert from 'node:assert/strict';
import test from 'node:test';
import { isMatchingRecentPrivateReply } from '../src/services/tts-overlay-queue';
import type { PrivateChatMessage } from '../src/lib/private-chat-store';

const now = Date.parse('2026-08-08T02:40:00.000Z');

function message(input: Partial<PrivateChatMessage> & Pick<PrivateChatMessage, 'type' | 'message'>): PrivateChatMessage {
  return {
    type: input.type,
    username: input.username || (input.type === 'ai' ? 'Athena' : 'Commander'),
    message: input.message,
    timestamp: input.timestamp || new Date(now - 15_000).toISOString(),
  };
}

test('recognizes the newly saved private Athena reply before stream TTS can queue it', () => {
  const messages = [
    message({ type: 'user', message: 'Continue privately.' }),
    message({ type: 'ai', message: 'A private response with deliberate spacing.\n\nSecond line.' }),
  ];

  assert.equal(
    isMatchingRecentPrivateReply(
      'A private response with deliberate spacing. Second line.',
      messages,
      now,
    ),
    true,
  );
});

test('does not suppress unrelated public speech', () => {
  const messages = [
    message({ type: 'ai', message: 'The latest private answer.' }),
  ];

  assert.equal(
    isMatchingRecentPrivateReply('A separate public-channel answer.', messages, now),
    false,
  );
});

test('does not treat an old private response as the current Discord delivery', () => {
  const messages = [
    message({
      type: 'ai',
      message: 'An old private answer.',
      timestamp: new Date(now - 5 * 60_000).toISOString(),
    }),
  ];

  assert.equal(
    isMatchingRecentPrivateReply('An old private answer.', messages, now),
    false,
  );
});

test('uses only the latest private assistant turn', () => {
  const messages = [
    message({ type: 'ai', message: 'Earlier answer.' }),
    message({ type: 'user', message: 'Another private prompt.' }),
    message({ type: 'ai', message: 'Newest answer.' }),
  ];

  assert.equal(isMatchingRecentPrivateReply('Earlier answer.', messages, now), false);
  assert.equal(isMatchingRecentPrivateReply('Newest answer.', messages, now), true);
});
