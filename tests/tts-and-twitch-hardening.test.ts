import assert from 'node:assert/strict';
import test from 'node:test';
import { getTTSFallbackProviders, getTTSProviderCooldownMs } from '../src/services/tts-provider';
import { normalizeTwitchUserIdentifier } from '../src/services/twitch';

test('TTS fallback order includes every configured provider once', () => {
  assert.deepEqual(getTTSFallbackProviders('gemini'), ['edenai', 'openai']);
  assert.deepEqual(getTTSFallbackProviders('openai'), ['gemini', 'edenai']);
  assert.deepEqual(getTTSFallbackProviders('edenai'), ['gemini', 'openai']);
});

test('TTS provider auth and quota failures receive bounded cooldowns', () => {
  assert.equal(getTTSProviderCooldownMs(new Error('API key was reported as leaked: 403')), 6 * 60 * 60 * 1000);
  assert.equal(getTTSProviderCooldownMs(new Error('RESOURCE_EXHAUSTED quota 429')), 15 * 60 * 1000);
  assert.equal(getTTSProviderCooldownMs(new Error('temporary socket close')), 0);
});

test('Twitch user identifiers are normalized before Helix lookup', () => {
  assert.equal(normalizeTwitchUserIdentifier(' @MadiRed29: '), 'madired29');
  assert.equal(normalizeTwitchUserIdentifier('CaptainSlasher1:'), 'captainslasher1');
  assert.equal(normalizeTwitchUserIdentifier(' 47145728 ', 'id'), '47145728');
  assert.equal(normalizeTwitchUserIdentifier('not-a-twitch-login'), '');
});
