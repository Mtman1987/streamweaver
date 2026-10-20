import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readAICostPolicy, AI_PAUSED_MESSAGE } from '../src/services/ai-cost-policy';
import { generateAIResponse } from '../src/services/ai-provider';
import { requestPrivateChatCompletion } from '../src/services/private-chat-ai';
import { requestOpenAiFallback, isOpenAiFallbackConfigured } from '../src/services/openai-fallback';
import { generateTTS, generateDeepgramTTS, generateOpenAITTS } from '../src/services/tts-provider';
import { getTtsVoiceOption, KOKORO_VOICE_OPTIONS } from '../src/lib/tts-voices';
import { generateImageWithOpenAI, generateImageWithEdenAI, generateImageWithSeaArt } from '../src/services/image-provider';
import { generateImageWithCloudflare } from '../src/services/cloudflare-image';
import { moderateImagePrompt } from '../src/services/image-content-moderation';
import { optimizeImagePrompt } from '../src/services/image-command';
import { translateToLanguage } from '../src/services/translation';
import { NextRequest } from 'next/server';
import { serializeSessionCookie } from '../src/lib/session-cookie';
import { POST as condensePrivateMemory } from '../src/app/api/private-ltm/condense/route';
import { POST as optimizePersonality } from '../src/app/api/ai/optimize-personality/route';
import { generateFreeTTS } from '../src/services/free-tts';

test('Kokoro voice picker and local synthesis worker expose the same voices', () => {
  const workerSource = readFileSync(new URL('../workers/free-tts/server.py', import.meta.url), 'utf8');
  const allowlist = workerSource.match(/^VOICES = \{([^}]+)\}/m);
  assert.ok(allowlist, 'Kokoro worker voice allowlist must exist');
  const workerVoices = Array.from(allowlist[1].matchAll(/"([^"]+)"/g), (match) => match[1]).sort();
  const pickerVoices = KOKORO_VOICE_OPTIONS.map((voice) => voice.id.slice('kokoro:'.length)).sort();
  assert.deepEqual(pickerVoices, workerVoices, 'every selectable Kokoro voice must be accepted by the deployed synthesis worker');
});

test('free-only policy prevents paid calls even with credentials and retries free TTS voices', async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'free-ai-policy-'));
  const file = path.join(dir, 'policy.json');
  const oldPath = process.env.AI_COST_POLICY_PATH;
  process.env.AI_COST_POLICY_PATH = file;
  t.after(() => {
    if (oldPath === undefined) delete process.env.AI_COST_POLICY_PATH;
    else process.env.AI_COST_POLICY_PATH = oldPath;
    rmSync(dir, { recursive: true, force: true });
  });
  assert.equal(readAICostPolicy().paidRoutesEnabled, false);
  writeFileSync(file, '{bad JSON');
  assert.equal(readAICostPolicy().paidRoutesEnabled, false);
  writeFileSync(file, JSON.stringify({ paidRoutesEnabled: 'true' }));
  assert.equal(readAICostPolicy().paidRoutesEnabled, false);
  writeFileSync(file, JSON.stringify({ paidRoutesEnabled: false }));
  let calls = 0;
  let fail = false;
  const wav = Buffer.alloc(64); wav.write('RIFF'); wav.write('WAVE', 8);
  t.mock.method(globalThis, 'fetch', async (url: any, init?: RequestInit) => {
    calls++;
    assert.equal(String(url), 'http://127.0.0.1:8080/v1/audio/speech');
    const body = JSON.parse(String(init?.body));
    assert.ok(['af_heart', 'af_bella', 'af_nicole', 'af_kore', 'af_sarah', 'af_aoede', 'af_alloy', 'af_jessica', 'af_nova', 'af_river', 'af_sky', 'am_michael', 'am_puck', 'am_fenrir', 'am_adam', 'am_echo', 'am_eric', 'am_liam', 'am_onyx', 'am_santa', 'bm_george', 'bf_emma', 'bf_alice', 'bf_isabella', 'bf_lily', 'bm_daniel', 'bm_fable', 'bm_lewis'].includes(body.voice));
    assert.equal(new Headers(init?.headers).has('authorization'), false);
    return fail ? new Response(null, { status: 503 }) : new Response(wav, { headers: { 'content-type': 'audio/wav' } });
  });
  assert.equal(await generateAIResponse('Hello'), AI_PAUSED_MESSAGE);
  assert.equal(isOpenAiFallbackConfigured('existing-key'), false);
  await assert.rejects(requestOpenAiFallback({ messages: [{ role: 'user', content: 'Hello' }], options: { apiKey: 'existing-key' } }), { code: 'AI_PROVIDER_PAUSED' });
  await assert.rejects(generateDeepgramTTS('Hello', 'existing-key'), { code: 'AI_PROVIDER_PAUSED' });
  await assert.rejects(generateOpenAITTS('Hello', getTtsVoiceOption('edenai:openai:nova'), 'existing-key'), { code: 'AI_PROVIDER_PAUSED' });
  const privateReply = await requestPrivateChatCompletion({ apiKey: 'existing-key', systemPrompt: '', prompt: 'Hello' });
  assert.equal(privateReply.text, '');
  assert.match(privateReply.upstreamError || '', /paused/);
  for (const adapter of [generateImageWithOpenAI, generateImageWithEdenAI, generateImageWithSeaArt, generateImageWithCloudflare]) {
    await assert.rejects(adapter({ prompt: 'A mountain', tenantId: 'trial-test' }), { code: 'AI_PROVIDER_PAUSED' });
  }
  await assert.rejects(moderateImagePrompt('A mountain', 'trial-test'), { code: 'AI_PROVIDER_PAUSED' });
  assert.equal(await optimizeImagePrompt('A mountain', {} as any), 'A mountain');
  assert.equal((await translateToLanguage('Hello Carl', 'es')).translatedText, 'Hello Carl');
  const cookie = serializeSessionCookie({ id: 'trial-test', username: 'trial' });
  const memoryResponse = await condensePrivateMemory(new NextRequest('http://localhost/api/private-ltm/condense', { method: 'POST', headers: { cookie: `streamweaver-session=${cookie}`, 'content-type': 'application/json' }, body: '{}' }));
  const memoryResult = await memoryResponse.json();
  assert.equal(memoryResult.success, false);
  assert.equal(memoryResult.available, false, 'a pause notice must never become a memory');
  const personalityResponse = await optimizePersonality(new NextRequest('http://localhost/api/ai/optimize-personality', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ personality: 'Kind and curious' }) }));
  const personalityResult = await personalityResponse.json();
  assert.equal(personalityResult.optimized, 'Kind and curious');
  assert.equal(personalityResult.available, false);
  assert.equal(calls, 0);
  assert.match(await generateTTS('Hello.', 'deepgram:aura-2-athena-en', 'trial-test'), /^data:audio\/wav;base64,/);
  assert.match(await generateTTS('Hello.', 'kokoro:am_michael', 'trial-test'), /^data:audio\/wav;base64,/);
  assert.equal(calls, 2);
  fail = true;
  assert.deepEqual(await Promise.all(Array.from({ length: 20 }, () => generateFreeTTS('Hello.', 'af_heart'))), Array(20).fill(''));
  assert.equal(calls, 5, 'preferred voice plus two free fallbacks are tried once before cooldown');
  assert.equal(await generateTTS('Another.', undefined, 'trial-test'), '');
  assert.equal(calls, 5);
});


test('free Pollinations image generation uses fresh seeds to avoid repeating cached images', async () => {
  const { generateImageWithPollinations } = await import('../src/services/image-provider');
  const originalRandom = Math.random;
  try {
    Math.random = () => 0.1;
    const first = await generateImageWithPollinations({
      prompt: 'a quiet mountain landscape',
      providerParams: { safe: true },
    });
    Math.random = () => 0.8;
    const second = await generateImageWithPollinations({
      prompt: 'a quiet mountain landscape',
      providerParams: { safe: true },
    });
    assert.ok(first.imageResourceUrl);
    assert.equal(new URL(String(first.imageResourceUrl)).searchParams.get('safe'), 'true');
    const firstUrl = new URL(String(first.imageResourceUrl));
    const secondUrl = new URL(String(second.imageResourceUrl));
    assert.ok(firstUrl.searchParams.get('seed'), 'every fallback URL must have an explicit seed');
    assert.notEqual(firstUrl.searchParams.get('seed'), secondUrl.searchParams.get('seed'));
    assert.notEqual(first.imageResourceUrl, second.imageResourceUrl);
  } finally {
    Math.random = originalRandom;
  }
});
