import assert from 'node:assert/strict';
import test from 'node:test';
import { NextRequest } from 'next/server';
import { generateTTS, getLifelikeFallbackVoices, getTTSProviderCooldownMs } from '../src/services/tts-provider';
import {
  DEFAULT_TTS_VOICE,
  TTS_VOICE_OPTIONS,
  normalizeTtsProvider,
  normalizeTtsVoice,
} from '../src/lib/tts-voices';
import {
  TTS_CONSUMER_PRESENCE_TTL_MS,
  forgetTtsConsumerMemoryForTest,
  hasActiveTtsConsumer,
  touchTtsConsumer,
} from '../src/services/tts-consumer-presence';
import { normalizeTwitchUserIdentifier } from '../src/services/twitch';

test('TTS catalog is Eden-only and contains named voice models', () => {
  assert.equal(normalizeTtsProvider('gemini'), 'edenai');
  assert.equal(normalizeTtsProvider('openai'), 'edenai');
  assert.ok(TTS_VOICE_OPTIONS.length >= 10);
  for (const voice of TTS_VOICE_OPTIONS) {
    assert.equal(voice.provider, 'edenai');
    assert.ok(voice.edenaiVoiceModel);
    assert.doesNotMatch(voice.edenaiVoiceModel, /^(?:MALE|FEMALE)$/);
  }
});

test('legacy and unknown voices normalize to curated Eden voices', () => {
  assert.equal(normalizeTtsVoice('openai:nova'), 'edenai:openai:nova');
  assert.equal(normalizeTtsVoice('edenai:google:FEMALE'), 'edenai:google:en-US-Wavenet-F');
  assert.equal(normalizeTtsVoice('unknown female voice'), DEFAULT_TTS_VOICE);
  assert.equal(normalizeTtsVoice('Aoede'), DEFAULT_TTS_VOICE);
});

test('lifelike fallbacks preserve gender and use named Eden voices', () => {
  const fallbacks = getLifelikeFallbackVoices('edenai:amazon:Matthew');
  assert.deepEqual(fallbacks, [
    'edenai:openai:echo',
    'edenai:microsoft:en-US-GuyNeural',
    'edenai:google:en-US-Wavenet-D',
  ]);
});

test('automatic paid TTS requires a recent tenant consumer heartbeat', () => {
  const tenantId = `presence-test-${Date.now()}`;
  const now = Date.now();
  assert.equal(hasActiveTtsConsumer(tenantId, 'overlay', now), false);
  assert.equal(touchTtsConsumer(tenantId, 'overlay'), true);
  assert.equal(hasActiveTtsConsumer(tenantId, 'overlay', now), true);
  assert.equal(hasActiveTtsConsumer(tenantId, 'say', now), false);
  assert.equal(touchTtsConsumer(tenantId, 'say'), true);
  assert.equal(hasActiveTtsConsumer(tenantId, 'say', now), true);
  assert.equal(hasActiveTtsConsumer(tenantId, 'overlay', now + (TTS_CONSUMER_PRESENCE_TTL_MS * 2)), false);
});

test('automatic TTS sees a heartbeat written by another runtime process', () => {
  const tenantId = `cross-process-presence-${Date.now()}`;
  assert.equal(touchTtsConsumer(tenantId, 'overlay'), true);
  forgetTtsConsumerMemoryForTest(tenantId, 'overlay');
  assert.equal(hasActiveTtsConsumer(tenantId, 'overlay'), true);
});

test('automatic TTS skips before resolving credentials when nobody is listening', async () => {
  const result = await generateTTS(
    'This request should not reach Eden AI.',
    undefined,
    `unused-tenant-${Date.now()}`,
    { requireActiveConsumer: true },
  );
  assert.equal(result, '');
});

test('say queue skips paid synthesis when no say player or mixer is active', async () => {
  const { POST } = await import('../src/app/api/say/queue/route');
  const tenantId = `twitch:no-say-listener-${Date.now()}`;
  const response = await POST(new NextRequest('http://localhost/api/say/queue', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tenantId, text: 'This should not reach Eden AI.' }),
  }));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.skipped, true);
  assert.equal(body.reason, 'no-active-say-listener');
  assert.equal(body.queued, 0);
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
