import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { pcmToWav, generateScottishTTS, SCOTTISH_VOICE_ID } from '../src/services/gemini-scottish-tts';
import { normalizeTtsProvider, normalizeTtsVoice } from '../src/lib/tts-voices';

test('Scottish voice uses verified free Gemini, preserves the accent and returns playable WAV', async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'scottish-tts-'));
  const file = path.join(root, 'policy.json');
  const saved = { policy: process.env.AI_COST_POLICY_PATH, key: process.env.GEMINI_API_KEY, persist: process.env.PERSIST_ROOT };
  process.env.AI_COST_POLICY_PATH = file;
  process.env.GEMINI_API_KEY = 'test-key';
  process.env.PERSIST_ROOT = root;
  t.after(() => {
    for (const [env, value] of [['AI_COST_POLICY_PATH', saved.policy], ['GEMINI_API_KEY', saved.key], ['PERSIST_ROOT', saved.persist]]) {
      if (value === undefined) delete process.env[env!]; else process.env[env!] = value;
    }
    rmSync(root, { recursive: true, force: true });
  });
  assert.equal(normalizeTtsProvider('gemini'), 'gemini');
  assert.equal(normalizeTtsVoice(SCOTTISH_VOICE_ID), SCOTTISH_VOICE_ID);
  let calls = 0;
  let status = 200;
  const pcm = Buffer.alloc(4800);
  t.mock.method(globalThis, 'fetch', async (url: any, init?: RequestInit) => {
    calls++;
    assert.equal(String(url), 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent');
    const body = JSON.parse(String(init?.body));
    assert.match(body.contents[0].parts[0].text, /Scottish English accent/);
    assert.match(body.contents[0].parts[0].text, /Hello captain/);
    assert.equal(body.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName, 'Charon');
    assert.equal(new Headers(init?.headers).get('x-goog-api-key'), 'test-key');
    return status !== 200 ? new Response('{}', { status }) : Response.json({
      candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/L16;codec=pcm;rate=24000', data: pcm.toString('base64') } }] } }],
    });
  });
  writeFileSync(file, JSON.stringify({ paidRoutesEnabled: false, geminiFreeTierVerified: false }));
  await assert.rejects(generateScottishTTS('Hello captain'), /free tier/);
  assert.equal(calls, 0);
  writeFileSync(file, JSON.stringify({ paidRoutesEnabled: false, geminiFreeTierVerified: true }));
  const { generateTTS, getTTSConfig } = await import('../src/services/tts-provider');
  const { writeUserConfig } = await import('../src/lib/user-config');
  await writeUserConfig({ TTS_VOICE: SCOTTISH_VOICE_ID, TTS_PROVIDER: 'gemini' }, 'scottish-test');
  assert.equal(getTTSConfig('scottish-test').voice, SCOTTISH_VOICE_ID, 'free-only mode must preserve the saved accent');
  assert.equal(getTTSConfig('scottish-test').provider, 'gemini');
  const audio = await generateTTS('Hello captain', undefined, 'scottish-test');
  const wav = Buffer.from(audio.split(',')[1], 'base64');
  assert.equal(wav.subarray(0, 4).toString(), 'RIFF');
  assert.equal(wav.subarray(8, 12).toString(), 'WAVE');
  assert.equal(wav.readUInt32LE(24), 24000);
  assert.equal(wav.readUInt32LE(40), pcm.length);
  assert.deepEqual(wav.subarray(44), pcm);
  assert.throws(() => pcmToWav(Buffer.alloc(1)), /Invalid/);
  status = 429;
  await assert.rejects(generateTTS('Hello captain', SCOTTISH_VOICE_ID), /429/);
  assert.equal(await generateTTS('Hello captain', SCOTTISH_VOICE_ID), '');
  assert.equal(calls, 2, 'quota failure cools down without retry or a paid/different-accent fallback');
});
