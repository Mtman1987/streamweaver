import assert from 'node:assert/strict';
import test from 'node:test';
import type { PrivateChatMessage } from '../src/lib/private-chat-store';
import {
  findPrivateAiCursorByText,
  latestPrivateAiCursor,
  listPrivateAiTurnsAfter,
} from '../src/services/private-dm-live-tts';

function entry(
  type: 'user' | 'ai',
  message: string,
  timestamp: string,
): PrivateChatMessage {
  return {
    type,
    username: type === 'ai' ? 'Athena' : 'Commander',
    message,
    timestamp,
  };
}

const history: PrivateChatMessage[] = [
  entry('user', 'First question', '2026-08-09T17:00:00.000Z'),
  entry('ai', 'First Athena answer.', '2026-08-09T17:00:01.000Z'),
  entry('user', 'Second question', '2026-08-09T17:00:02.000Z'),
  entry('ai', 'Second Athena answer.', '2026-08-09T17:00:03.000Z'),
  entry('user', 'Third question', '2026-08-09T17:00:04.000Z'),
  entry('ai', 'Third Athena answer.', '2026-08-09T17:00:05.000Z'),
];

test('private live TTS returns only Athena replies after the cursor', () => {
  const after = Date.parse('2026-08-09T17:00:01.000Z');
  const turns = listPrivateAiTurnsAfter(history, after);
  assert.deepEqual(turns.map((turn) => turn.text), [
    'Second Athena answer.',
    'Third Athena answer.',
  ]);
  assert.deepEqual(turns.map((turn) => turn.question), [
    'Second question',
    'Third question',
  ]);
  assert.equal(turns.some((turn) => turn.text.includes('question')), false);
});

test('clicked Athena reply can be matched back to its private-history cursor', () => {
  const cursor = findPrivateAiCursorByText(history, '  Second Athena answer.  ');
  assert.equal(cursor, Date.parse('2026-08-09T17:00:03.000Z'));
  assert.equal(findPrivateAiCursorByText(history, 'Second question'), 0);
});

test('latest private TTS cursor ignores user messages', () => {
  const withLaterUser = [
    ...history,
    entry('user', 'A later user-only turn', '2026-08-09T18:00:00.000Z'),
  ];
  assert.equal(
    latestPrivateAiCursor(withLaterUser),
    Date.parse('2026-08-09T17:00:05.000Z'),
  );
});
