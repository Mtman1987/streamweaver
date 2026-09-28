import test from 'node:test';
import assert from 'node:assert/strict';

import {
  cancelNextSayEcho,
  clearSaySuppressionForTenant,
  consumeNextSayEcho,
  formatSaySpeechText,
  isSaySuppressedForTenant,
  isSayTextSpeakable,
  stripTwitchEmotesFromText,
  suppressNextSayEcho,
  suppressSayForTenant,
} from '../src/services/say-tts';

test('Twitch emotes are stripped before say TTS speech is queued', () => {
  const cleaned = stripTwitchEmotesFromText('hello Kappa friend PogChamp', {
    '25': ['6-10'],
    '88': ['19-26'],
  });

  assert.equal(cleaned, 'hello friend');
  assert.equal(isSayTextSpeakable(cleaned), true);
});

test('emote-only Twitch messages are not speakable for say TTS', () => {
  const cleaned = stripTwitchEmotesFromText('Kappa Kappa', {
    '25': ['0-4', '6-10'],
  });

  assert.equal(cleaned, '');
  assert.equal(isSayTextSpeakable(cleaned), false);
});

test('say TTS can be suppressed during shoutouts', () => {
  const key = 'mamafeisty';

  clearSaySuppressionForTenant(key);
  assert.equal(isSaySuppressedForTenant(key), false);

  suppressSayForTenant(key, 10_000, 'test');
  assert.equal(isSaySuppressedForTenant(key), true);

  clearSaySuppressionForTenant(key);
  assert.equal(isSaySuppressedForTenant(key), false);
});

test('say TTS ignores numbers in speaker names but preserves numbers in messages', () => {
  const spoken = formatSaySpeechText(
    'speaker-number-test',
    'mtman1987',
    'I have 2 passes left',
  );

  assert.equal(spoken, 'mtman said: I have 2 passes left');
});


test('STT say echo suppression is exact, speaker-scoped, and consume-once', () => {
  suppressNextSayEcho('spacemountainlive', 'spacemountainlive', 'hello from STT');

  assert.equal(consumeNextSayEcho('spacemountainlive', 'someoneelse', 'hello from STT'), false);
  assert.equal(consumeNextSayEcho('spacemountainlive', 'spacemountainlive', 'different text'), false);
  assert.equal(consumeNextSayEcho('spacemountainlive', 'spacemountainlive', 'hello from STT'), true);
  assert.equal(consumeNextSayEcho('spacemountainlive', 'spacemountainlive', 'hello from STT'), false);
});

test('STT say echo suppression supports cancellation after a failed send', () => {
  suppressNextSayEcho('spacemountainlive', 'spacemountainlive', 'failed STT');
  cancelNextSayEcho('spacemountainlive', 'spacemountainlive', 'failed STT');
  assert.equal(consumeNextSayEcho('spacemountainlive', 'spacemountainlive', 'failed STT'), false);
});
