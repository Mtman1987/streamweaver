import assert from 'node:assert/strict';
import test from 'node:test';
import { generateTTS } from '../src/services/tts-provider';
import { ATHENA_CANONICAL_TTS_VOICE, ATHENA_TENANT_ID } from '../src/lib/tts-voices';

const audioUrl = 'https://audio.example.test/athena.mp3';
const audioBytes = Buffer.from([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 0]);

function configure(t: any, deepgramKey = '') {
  const eden = process.env.EDENAI_API_KEY;
  const deepgram = process.env.DEEPGRAM_API_KEY;
  process.env.EDENAI_API_KEY = 'test-eden-key';
  process.env.DEEPGRAM_API_KEY = deepgramKey;
  t.after(() => {
    if (eden === undefined) delete process.env.EDENAI_API_KEY;
    else process.env.EDENAI_API_KEY = eden;
    if (deepgram === undefined) delete process.env.DEEPGRAM_API_KEY;
    else process.env.DEEPGRAM_API_KEY = deepgram;
  });
}

test('Athena keeps her exact voice using only the existing Eden AI credential', async (t) => {
  configure(t);
  const requests: string[] = [];
  t.mock.method(globalThis, 'fetch', async (input: any, init?: RequestInit) => {
    requests.push(String(input));
    if (requests.length === 1) {
      assert.equal(input, 'https://api.edenai.run/v3/universal-ai');
      assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer test-eden-key');
      assert.deepEqual(JSON.parse(String(init?.body)), {
        model: 'audio/tts/deepgram/aura-2',
        input: { text: 'Hello Commander.', voice: 'aura-2-athena-en', audio_format: 'mp3' },
      });
      return Response.json({ status: 'success', provider: 'deepgram', output: { audio_resource_url: audioUrl } });
    }
    assert.equal(input, audioUrl);
    assert.equal(new Headers(init?.headers).has('authorization'), false);
    return new Response(audioBytes, { headers: { 'content-type': 'binary/octet-stream' } });
  });
  // A caller asking for another voice must not unpin Athena's selected identity.
  const result = await generateTTS('Hello Commander.', 'edenai:openai:nova', ATHENA_TENANT_ID);
  assert.equal(result, `data:audio/mpeg;base64,${audioBytes.toString('base64')}`);
  assert.equal(requests.length, 2);
});

test('an existing direct Deepgram credential retains its direct route', async (t) => {
  configure(t, 'test-deepgram-key');
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (input: any, init?: RequestInit) => {
    calls++;
    assert.equal(input, 'https://api.deepgram.com/v1/speak?model=aura-2-athena-en');
    assert.equal(new Headers(init?.headers).get('authorization'), 'Token test-deepgram-key');
    return new Response(audioBytes, { headers: { 'content-type': 'audio/mpeg' } });
  });
  assert.match(await generateTTS('Direct voice check.', undefined, ATHENA_TENANT_ID), /^data:audio\/mpeg;base64,/);
  assert.equal(calls, 1);
});

for (const failure of [401, 402, 429, 503, 'network', 'empty-audio', 'non-audio']) {
  test(`direct Deepgram ${failure} falls back to identical Athena without repeated failing calls`, async (t) => {
    configure(t, `test-direct-${failure}`);
    const tenant = `tts-direct-${failure}`;
    const calls: string[] = [];
    t.mock.method(globalThis, 'fetch', async (input: any, init?: RequestInit) => {
      const url = String(input);
      calls.push(url);
      if (url.startsWith('https://api.deepgram.com/')) {
        assert.ok(url.endsWith('model=aura-2-athena-en'));
        if (failure === 'network') throw new TypeError('fetch failed');
        if (failure === 'empty-audio') return new Response(null);
        if (failure === 'non-audio') return Response.json({ error: 'unavailable' });
        return new Response(null, { status: Number(failure) });
      }
      if (url === 'https://api.edenai.run/v3/universal-ai') {
        assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer test-eden-key');
        const body = JSON.parse(String(init?.body));
        assert.equal(body.model, 'audio/tts/deepgram/aura-2');
        assert.equal(body.input.voice, 'aura-2-athena-en');
        return Response.json({ status: 'success', provider: 'deepgram', output: { audio_resource_url: audioUrl } });
      }
      assert.equal(url, audioUrl);
      return new Response(audioBytes, { headers: { 'content-type': 'audio/mpeg' } });
    });
    const expected = `data:audio/mpeg;base64,${audioBytes.toString('base64')}`;
    assert.equal(await generateTTS('Same voice.', ATHENA_CANONICAL_TTS_VOICE, tenant), expected);
    assert.equal(await generateTTS('Next reply.', ATHENA_CANONICAL_TTS_VOICE, tenant), expected);
    assert.equal(calls.filter(url => url.startsWith('https://api.deepgram.com/')).length, 1);
    assert.equal(calls.filter(url => url === 'https://api.edenai.run/v3/universal-ai').length, 2);
  });
}

test('a replacement direct key recovers immediately even when both providers were unavailable', async (t) => {
  configure(t, 'test-old-direct');
  let restored = false;
  let callsAfterRecovery = 0;
  t.mock.method(globalThis, 'fetch', async (input: any, init?: RequestInit) => {
    if (!restored) return new Response(null, { status: 401 });
    callsAfterRecovery++;
    assert.equal(String(input), 'https://api.deepgram.com/v1/speak?model=aura-2-athena-en');
    assert.equal(new Headers(init?.headers).get('authorization'), 'Token test-replacement-direct');
    return new Response(audioBytes, { headers: { 'content-type': 'audio/mpeg' } });
  });
  await assert.rejects(generateTTS('Check.', ATHENA_CANONICAL_TTS_VOICE, 'tts-key-recovery'), /Lifelike TTS failed/);
  restored = true;
  process.env.DEEPGRAM_API_KEY = 'test-replacement-direct';
  assert.match(await generateTTS('Recovered.', ATHENA_CANONICAL_TTS_VOICE, 'tts-key-recovery'), /^data:audio\/mpeg;base64,/);
  assert.equal(callsAfterRecovery, 1);
});

for (const failure of ['provider-failed', 'wrong-provider', 'missing-url', 'empty-audio', 'non-audio']) {
  test(`pinned Athena rejects ${failure} without substituting another speaker`, async (t) => {
    configure(t);
    let calls = 0;
    t.mock.method(globalThis, 'fetch', async () => {
      calls++;
      if (calls === 1) {
        return Response.json({
          status: failure === 'provider-failed' ? 'fail' : 'success',
          provider: failure === 'wrong-provider' ? 'openai' : 'deepgram',
          output: { audio_resource_url: failure === 'missing-url' ? undefined : audioUrl },
        });
      }
      return new Response(failure === 'empty-audio' ? null : audioBytes, {
        headers: { 'content-type': failure === 'non-audio' ? 'application/json' : 'audio/mpeg' },
      });
    });
    await assert.rejects(generateTTS('Voice check.', ATHENA_CANONICAL_TTS_VOICE, `tts-${failure}`), /Lifelike TTS failed/);
    assert.equal(calls, ['empty-audio', 'non-audio'].includes(failure) ? 2 : 1);
  });
}
