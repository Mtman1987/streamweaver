import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/services/ai-provider.ts', import.meta.url), 'utf8')
  .replace(/^import .*;\n/gm, '')
  .replace(/\bexport /g, '') +
  '\nglobalThis.generateEdenAIResponseForTest = generateEdenAIResponse;';
const executable = stripTypeScriptTypes(source, { mode: 'strip' });

function completion(text, finishReason = 'stop') {
  return { ok: true, json: async () => ({
    choices: [{ message: { content: text }, finish_reason: finishReason }],
  }) };
}

async function generate(replies, options = {}, prompt = 'Hello') {
  let calls = 0;
  const requests = [];
  const context = {
    console: { warn() {} },
    process: { env: {} },
    fetch: async (_url, request) => {
      requests.push(JSON.parse(request.body));
      const reply = replies[calls++];
      if (reply instanceof Error) throw reply;
      return reply;
    },
  };
  vm.runInNewContext(executable, context);
  const text = await context.generateEdenAIResponseForTest(
    prompt, 'Be helpful', { model: 'test-model', apiKey: 'test-key' }, options,
  );
  return { text, calls, requests };
}

test('a short response ending without punctuation is a valid answer', async () => {
  const result = await generate([completion('Yes')], { maxTokens: 180 });
  assert.equal(result.text, 'Yes');
  assert.equal(result.calls, 1);
});

test('a length-limited response remains usable if continuation is unavailable', async () => {
  const result = await generate([
    completion('Here is the useful first part', 'length'),
    new Error('upstream temporarily unavailable'),
  ], { maxTokens: 180 });
  assert.equal(result.text, 'Here is the useful first part');
  assert.equal(result.calls, 2);
});

test('repeated output limits return the accumulated answer within the character cap', async () => {
  const result = await generate([
    completion('First part', 'length'),
    completion('second part', 'length'),
    completion('third part', 'length'),
  ], { maxTokens: 180, maxCharacters: 500 });
  assert.equal(result.text, 'First part second part third part');
  assert.equal(result.calls, 3);
});

test('an oversized conversation prompt retains the newest user turn', async () => {
  const prompt = 'old context '.repeat(10000) + 'Newest message: hello Stella';
  const result = await generate([completion('Hello back')], {}, prompt);
  const submitted = result.requests[0].messages.at(-1).content;
  assert.ok(submitted.length <= 24000);
  assert.ok(submitted.endsWith('Newest message: hello Stella'));
  assert.equal(result.text, 'Hello back');
});
