import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { generateScottishTTS, SCOTTISH_VOICE_ID } from '../src/services/gemini-scottish-tts';
import { normalizeTtsProvider, normalizeTtsVoice } from '../src/lib/tts-voices';

function testWav() {
  const audio = Buffer.alloc(48);
  audio.write('RIFF', 0); audio.writeUInt32LE(40, 4); audio.write('WAVE', 8);
  audio.write('fmt ', 12); audio.writeUInt32LE(16, 16); audio.writeUInt16LE(1, 20);
  audio.writeUInt16LE(1, 22); audio.writeUInt32LE(24000, 24); audio.writeUInt32LE(48000, 28);
  audio.writeUInt16LE(2, 32); audio.writeUInt16LE(16, 34);
  audio.write('data', 36); audio.writeUInt32LE(4, 40);
  return audio;
}

test('Gemini TTS uses the current Interactions API, structured delivery style and verified-free gate', async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'gemini-tts-'));
  const file = path.join(root, 'policy.json');
  const saved = { policy: process.env.AI_COST_POLICY_PATH, key: process.env.GEMINI_API_KEY, persist: process.env.PERSIST_ROOT };
  process.env.AI_COST_POLICY_PATH = file;
  process.env.GEMINI_API_KEY = 'test-key';
  process.env.PERSIST_ROOT = root;
  t.after(() => {
    for (const [env, value] of [['AI_COST_POLICY_PATH', saved.policy], ['GEMINI_API_KEY', saved.key], ['PERSIST_ROOT', saved.persist]] as const) {
      if (value === undefined) delete process.env[env]; else process.env[env] = value;
    }
    rmSync(root, { recursive: true, force: true });
  });
  assert.equal(normalizeTtsProvider('gemini'), 'gemini');
  assert.equal(normalizeTtsVoice(SCOTTISH_VOICE_ID), SCOTTISH_VOICE_ID);
  let calls = 0;
  let status = 200;
  const wav = testWav();
  t.mock.method(globalThis, 'fetch', async (url: any, init?: RequestInit) => {
    calls++;
    assert.equal(String(url), 'https://generativelanguage.googleapis.com/v1beta/interactions');
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model, 'gemini-3.8-flash-tts');
    assert.match(body.input[0].content[0].annotations[0].style, /Scottish English accent/);
    assert.match(body.input[0].content[0].text, /Hello captain/);
    assert.equal(body.generation_config.speech_config[0].voice, 'Charon');
    assert.equal(new Headers(init?.headers).get('x-goog-api-key'), 'test-key');
    return status !== 200 ? new Response('{}', { status }) : Response.json({
      steps: [{ type: 'model_output', content: [{ type: 'audio', data: wav.toString('base64') }] }],
    });
  });
  writeFileSync(file, JSON.stringify({ paidRoutesEnabled: false, geminiFreeTierVerified: false }));
  await assert.rejects(generateScottishTTS('Hello captain'), /free tier/);
  assert.equal(calls, 0);
  writeFileSync(file, JSON.stringify({ paidRoutesEnabled: false, geminiFreeTierVerified: true }));
  const { generateTTS, getTTSConfig } = await import('../src/services/tts-provider');
  const { writeUserConfig } = await import('../src/lib/user-config');
  await writeUserConfig({ TTS_VOICE: SCOTTISH_VOICE_ID, TTS_PROVIDER: 'gemini' }, 'scottish-test');
  await writeUserConfig({ TTS_VOICE: 'edenai:openai:nova', TTS_PROVIDER: 'edenai' }, 'local-default-test');
  assert.equal(getTTSConfig('local-default-test').voice, 'kokoro:af_heart', 'verifying a free Gemini tier must not silently switch unrelated speech to an external provider');
  assert.equal(getTTSConfig('scottish-test').voice, SCOTTISH_VOICE_ID, 'free-only mode must preserve saved Gemini voice');
  assert.equal(getTTSConfig('scottish-test').provider, 'gemini');
  const audio = await generateTTS('Hello captain', undefined, 'scottish-test');
  assert.match(audio, /^data:audio\/wav;base64,/);
  assert.deepEqual(Buffer.from(audio.split(',')[1], 'base64'), wav);
  status = 429;
  await assert.rejects(generateScottishTTS('Hello captain'), /429/);
  assert.equal(await generateScottishTTS('Hello captain'), '');
  assert.equal(calls, 2, 'quota failure cools down rather than retrying or enabling paid synthesis');
});

test('Gemini voice options include expressive female and male voices', async () => {
  const voices = await import('../src/lib/tts-voices');
  assert.equal(voices.getTtsVoiceOption('gemini:kore:natural').geminiVoice, 'Kore');
  assert.equal(voices.getTtsVoiceOption('gemini:puck:upbeat').geminiVoice, 'Puck');
  assert.ok(voices.GEMINI_VOICE_OPTIONS.every((voice) => Boolean(voice.speechStyle)));
});
