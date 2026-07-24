import test from 'node:test';
import assert from 'node:assert/strict';

import { mergeSpeechRecognitionSegments } from '../src/services/speech-transcript';

test('collapses progressive speech recognition hypotheses into the final utterance', () => {
  assert.equal(
    mergeSpeechRecognitionSegments([
      'hey',
      'hey how',
      'hey how are you',
      'hey, how are you mama',
    ]),
    'hey, how are you mama',
  );
});

test('preserves separate finalized speech segments', () => {
  assert.equal(
    mergeSpeechRecognitionSegments(['hey mama', 'how are you']),
    'hey mama how are you',
  );
});
