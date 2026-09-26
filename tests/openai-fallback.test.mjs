import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/services/openai-fallback.ts', import.meta.url), 'utf8')
  .replace(/\bexport /g, '') + '\nglobalThis.requestForTest = requestOpenAiFallback;';
const executable = stripTypeScriptTypes(source, { mode: 'strip' });

async function run(replies, model) {
  const requests = [];
  const context = {
    process: { env: {} },
    console: { warn() {} },
    AbortSignal,
    fetch: async (_url, init) => {
      requests.push(JSON.parse(init.body));
      const payload = replies.shift();
      return { ok: true, json: async () => payload };
    },
  };
  vm.runInNewContext(executable, context);
  const result = await context.requestForTest({
    messages: [{ role: 'user', content: 'Hello' }],
    options: { apiKey: 'test-key', maxTokens: 180, ...(model ? { model } : {}) },
  });
  return { result, requests };
}

test('a short visible answer is accepted without punctuation', async () => {
  const { result, requests } = await run([{ output_text: 'Yes' }]);
  assert.equal(result.text, 'Yes');
  assert.equal(result.model, 'gpt-4.1-mini');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].max_output_tokens, 256);
});

test('empty reasoning output retries with the known nonreasoning model', async () => {
  const { result, requests } = await run([
    { status: 'incomplete', output: [] },
    { output: [{ content: [{ type: 'output_text', text: 'Here I am' }] }] },
  ], 'gpt-5-mini');
  assert.equal(result.text, 'Here I am');
  assert.equal(result.model, 'gpt-4.1-mini');
  assert.equal(requests[1].max_output_tokens, 512);
});

test('a refusal is not retried as an empty response', async () => {
  const context = {
    process: { env: {} }, console: { warn() {} }, AbortSignal,
    fetch: async () => ({ ok: true, json: async () => ({ output: [{ content: [{ type: 'refusal', refusal: 'No' }] }] }) }),
  };
  vm.runInNewContext(executable, context);
  await assert.rejects(() => context.requestForTest({
    messages: [{ role: 'user', content: 'Hello' }], options: { apiKey: 'test', model: 'gpt-5-mini' },
  }), /declined/);
});
