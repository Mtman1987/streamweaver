import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/services/tts-provider.ts', import.meta.url), 'utf8');
const start = source.indexOf('export async function generateOpenAITTS(');
const end = source.indexOf('\nasync function generateEdenAITTS(', start);
const executable = stripTypeScriptTypes(source.slice(start, end).replace(/^export /, '') +
  '\nglobalThis.generateForTest = generateOpenAITTS;', { mode: 'strip' });

test('OpenAI speech uses the pinned voice and accepts nonempty audio', async () => {
  let request;
  const context = {
    Buffer,
    fetchWithRetry: async (url, init, options) => {
      request = { url, init, options };
      return { ok: true, headers: { get: () => 'audio/mpeg' },
        arrayBuffer: async () => Uint8Array.from([73, 68, 51]).buffer };
    },
  };
  vm.runInNewContext(executable, context);
  const result = await context.generateForTest('Hello', { edenaiProvider: 'openai', edenaiVoiceModel: 'nova' }, 'test-key');
  assert.equal(result, 'data:audio/mpeg;base64,SUQz');
  assert.equal(request.url, 'https://api.openai.com/v1/audio/speech');
  assert.equal(JSON.parse(request.init.body).voice, 'nova');
  assert.equal(JSON.parse(request.init.body).model, 'tts-1');
  assert.equal(request.options.attempts, 1);
});

test('OpenAI speech rejects empty or non-audio output', async () => {
  const context = {
    Buffer,
    fetchWithRetry: async () => ({
      ok: true, headers: { get: () => 'application/json' },
      arrayBuffer: async () => new ArrayBuffer(0),
    }),
  };
  vm.runInNewContext(executable, context);
  await assert.rejects(() => context.generateForTest('Hello', { edenaiProvider: 'openai', edenaiVoiceModel: 'nova' }, 'test'), /non-audio/);
});
