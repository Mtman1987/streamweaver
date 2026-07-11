import test from 'node:test';
import assert from 'node:assert/strict';

import {
  clearSaySuppressionForTenant,
  isSaySuppressedForTenant,
  isSayTextSpeakable,
  stripTwitchEmotesFromText,
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
