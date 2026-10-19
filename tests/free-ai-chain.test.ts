import assert from 'node:assert/strict';
import test, { beforeEach, afterEach } from 'node:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  generateFreeChainResponse,
  isFreeChainConfigured,
  resetFreeChainCooldowns,
  getFreeChainStatus,
} from '../src/services/free-ai-chain';
import { FreeChatUnavailableError } from '../src/services/free-gemini-chat';
import { generateAIResponse } from '../src/services/ai-provider';
import { AI_PAUSED_MESSAGE } from '../src/services/ai-cost-policy';

const ENV_KEYS = [
  'AI_COST_POLICY_PATH', 'GEMINI_API_KEY', 'GROQ_API_KEY', 'GROQ_MODEL', 'CEREBRAS_API_KEY', 'CEREBRAS_MODEL',
  'OPENROUTER_API_KEY', 'OPENROUTER_MODEL', 'NVIDIA_API_KEY', 'NVIDIA_2_API_KEY', 'NVIDIA_NIM_MODEL', 'MISTRAL_API_KEY', 'MISTRAL_MODEL', 'SPMT_LOCAL_LLM_ENABLED',
];
const saved: Record<string, string | undefined> = {};
let dir = '';
let policyFile = '';
let keyCounter = 0;

function writePolicy(policy: Record<string, unknown>) {
  writeFileSync(policyFile, JSON.stringify({ paidRoutesEnabled: false, ...policy }));
}

function chatReply(text: string) {
  return new Response(JSON.stringify({ choices: [{ message: { content: text }, finish_reason: 'stop' }] }), {
    status: 200, headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  for (const key of ENV_KEYS) { saved[key] = process.env[key]; delete process.env[key]; }
  dir = mkdtempSync(path.join(tmpdir(), 'free-chain-'));
  policyFile = path.join(dir, 'policy.json');
  process.env.AI_COST_POLICY_PATH = policyFile;
  writePolicy({});
  resetFreeChainCooldowns();
  keyCounter += 1; // Gemini keeps per-key cooldowns at module level, so each test uses a fresh key.
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key];
  }
  rmSync(dir, { recursive: true, force: true });
});

test('no keys configured means paused, not a crash', async () => {
  assert.equal(isFreeChainConfigured(), false);
  assert.equal(await generateAIResponse('Hello'), AI_PAUSED_MESSAGE);
  await assert.rejects(generateFreeChainResponse('Hello'), { category: 'not_configured' });
});

test('a single non-Gemini key is enough to serve replies', async () => {
  process.env.GROQ_API_KEY = 'groq-test-key';
  assert.equal(isFreeChainConfigured(), true);
  let seen: { url: string; auth: string | null; model: string } | undefined;
  const fetchImpl = (async (url: any, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    seen = { url: String(url), auth: new Headers(init?.headers).get('authorization'), model: body.model };
    return chatReply('Hi from groq.');
  }) as typeof fetch;
  assert.equal(await generateFreeChainResponse('Hello', 'be nice', 't1', {}, fetchImpl), 'Hi from groq.');
  assert.equal(seen?.url, 'https://api.groq.com/openai/v1/chat/completions');
  assert.equal(seen?.auth, 'Bearer groq-test-key');
  assert.ok(seen?.model);
});

test('429 moves to the next provider and only that provider cools down', async () => {
  process.env.GROQ_API_KEY = 'groq-test-key';
  process.env.CEREBRAS_API_KEY = 'cerebras-test-key';
  const calls: string[] = [];
  const fetchImpl = (async (url: any) => {
    const host = new URL(String(url)).host;
    calls.push(host);
    if (host === 'api.groq.com') return new Response('{}', { status: 429, headers: { 'retry-after': '60' } });
    return chatReply('Hi from cerebras.');
  }) as typeof fetch;

  assert.equal(await generateFreeChainResponse('One', '', undefined, {}, fetchImpl), 'Hi from cerebras.');
  assert.equal(await generateFreeChainResponse('Two', '', undefined, {}, fetchImpl), 'Hi from cerebras.');
  assert.equal(calls.filter((host) => host === 'api.groq.com').length, 1, 'groq is skipped while cooling down');
  const status = getFreeChainStatus();
  assert.ok(status.find((entry) => entry.provider === 'groq')!.coolingDownSeconds > 0);
  assert.equal(status.find((entry) => entry.provider === 'cerebras')!.coolingDownSeconds, 0);
});

test('bad credential falls through and is not retried every turn', async () => {
  process.env.GROQ_API_KEY = 'revoked';
  process.env.MISTRAL_API_KEY = 'mistral-test-key';
  const calls: string[] = [];
  const fetchImpl = (async (url: any) => {
    const host = new URL(String(url)).host;
    calls.push(host);
    return host === 'api.groq.com' ? new Response('{}', { status: 401 }) : chatReply('Hi from mistral.');
  }) as typeof fetch;
  assert.equal(await generateFreeChainResponse('One', '', undefined, {}, fetchImpl), 'Hi from mistral.');
  assert.equal(await generateFreeChainResponse('Two', '', undefined, {}, fetchImpl), 'Hi from mistral.');
  assert.equal(calls.filter((host) => host === 'api.groq.com').length, 1);
});

test('request-shaped errors move on without cooling the provider down', async () => {
  process.env.GROQ_API_KEY = 'groq-test-key';
  process.env.CEREBRAS_API_KEY = 'cerebras-test-key';
  const calls: string[] = [];
  const fetchImpl = (async (url: any) => {
    const host = new URL(String(url)).host;
    calls.push(host);
    return host === 'api.groq.com' ? new Response('{"error":"too long"}', { status: 413 }) : chatReply('ok');
  }) as typeof fetch;
  await generateFreeChainResponse('One', '', undefined, {}, fetchImpl);
  await generateFreeChainResponse('Two', '', undefined, {}, fetchImpl);
  assert.equal(calls.filter((host) => host === 'api.groq.com').length, 2);
});

test('OpenRouter refuses non-free models so it can never spend credits', () => {
  process.env.OPENROUTER_API_KEY = 'or-test-key';
  process.env.OPENROUTER_MODEL = 'openai/gpt-4o';
  assert.equal(isFreeChainConfigured(), false);
  process.env.OPENROUTER_MODEL = 'openai/gpt-4o, meta-llama/llama-3.3-70b-instruct:free';
  assert.equal(isFreeChainConfigured(), true);
});

test('comma-separated models are tried in order inside one provider', async () => {
  process.env.GROQ_API_KEY = 'groq-test-key';
  process.env.GROQ_MODEL = 'model-a, model-b';
  const models: string[] = [];
  const fetchImpl = (async (_url: any, init?: RequestInit) => {
    const model = JSON.parse(String(init?.body)).model;
    models.push(model);
    return model === 'model-a' ? new Response('{}', { status: 429 }) : chatReply('from b');
  }) as typeof fetch;
  assert.equal(await generateFreeChainResponse('Hello', '', undefined, {}, fetchImpl), 'from b');
  assert.deepEqual(models, ['model-a', 'model-b']);
});

test('policy freeChain sets the order and per-call providers restrict it', async () => {
  process.env.GROQ_API_KEY = 'groq-test-key';
  process.env.MISTRAL_API_KEY = 'mistral-test-key';
  writePolicy({ freeChain: ['mistral', 'groq', 'not-a-provider'] });
  const hosts: string[] = [];
  const fetchImpl = (async (url: any) => { hosts.push(new URL(String(url)).host); return chatReply('ok'); }) as typeof fetch;
  await generateFreeChainResponse('Hello', '', undefined, {}, fetchImpl);
  assert.deepEqual(hosts, ['api.mistral.ai']);
  hosts.length = 0;
  await generateFreeChainResponse('Hello', '', undefined, { providers: ['groq'] }, fetchImpl);
  assert.deepEqual(hosts, ['api.groq.com']);
  assert.equal(isFreeChainConfigured(undefined, ['gemini']), false);
});

test('reasoning scratchpad is stripped and an empty reply falls through', async () => {
  process.env.GROQ_API_KEY = 'groq-test-key';
  process.env.CEREBRAS_API_KEY = 'cerebras-test-key';
  const fetchImpl = (async (url: any) => (
    new URL(String(url)).host === 'api.groq.com' ? chatReply('<think>still thinking...') : chatReply('<think>plan</think>Final answer.')
  )) as typeof fetch;
  assert.equal(await generateFreeChainResponse('Hello', '', undefined, {}, fetchImpl), 'Final answer.');
});

test('Gemini quota falls through to the next provider', async () => {
  writePolicy({ geminiFreeTierVerified: true });
  process.env.GEMINI_API_KEY = `gemini-test-key-${keyCounter}-quota`;
  process.env.GROQ_API_KEY = 'groq-test-key';
  const hosts: string[] = [];
  const fetchImpl = (async (url: any) => {
    const host = new URL(String(url)).host;
    hosts.push(host);
    return host === 'generativelanguage.googleapis.com' ? new Response('{}', { status: 429 }) : chatReply('Hi from groq.');
  }) as typeof fetch;
  assert.equal(await generateFreeChainResponse('Hello', '', undefined, {}, fetchImpl), 'Hi from groq.');
  assert.deepEqual(hosts, ['generativelanguage.googleapis.com', 'api.groq.com']);
});

test('a Gemini safety block is not shopped around to other providers', async () => {
  writePolicy({ geminiFreeTierVerified: true });
  process.env.GEMINI_API_KEY = `gemini-test-key-${keyCounter}-blocked`;
  process.env.GROQ_API_KEY = 'groq-test-key';
  const hosts: string[] = [];
  const fetchImpl = (async (url: any) => {
    hosts.push(new URL(String(url)).host);
    return new Response(JSON.stringify({ candidates: [{ finishReason: 'SAFETY' }] }), { status: 200 });
  }) as typeof fetch;
  await assert.rejects(generateFreeChainResponse('Hello', '', undefined, {}, fetchImpl), { category: 'blocked' });
  assert.deepEqual(hosts, ['generativelanguage.googleapis.com']);
});

test('every provider failing surfaces a FreeChatUnavailableError', async () => {
  process.env.GROQ_API_KEY = 'groq-test-key';
  process.env.CEREBRAS_API_KEY = 'cerebras-test-key';
  const fetchImpl = (async () => new Response('{}', { status: 503 })) as typeof fetch;
  await assert.rejects(
    generateFreeChainResponse('Hello', '', undefined, {}, fetchImpl),
    (error: unknown) => error instanceof FreeChatUnavailableError && error.category === 'upstream',
  );
});


test('NVIDIA NIM uses documented OpenAI-compatible endpoint and falls back across free models', async () => {
  process.env.NVIDIA_API_KEY = 'nim-test-key';
  const calls: Array<{ url: string; authorization: string | null; model: string; body: any }> = [];
  const fetchImpl = (async (url: any, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    calls.push({
      url: String(url),
      authorization: new Headers(init?.headers).get('authorization'),
      model: body.model,
      body,
    });
    if (body.model === 'openai/gpt-oss-20b') {
      return new Response(JSON.stringify({ error: { message: 'temporarily unavailable' } }), { status: 503 });
    }
    return chatReply('NVIDIA NIM fallback worked.');
  }) as typeof fetch;

  assert.equal(await generateFreeChainResponse('Hello from NIM', '', undefined, {}, fetchImpl), 'NVIDIA NIM fallback worked.');
  assert.deepEqual(calls.map(call => call.model), ['openai/gpt-oss-20b', 'z-ai/glm-5-3-flash']);
  assert.ok(calls.every(call => call.url === 'https://integrate.api.nvidia.com/v1/chat/completions'));
  assert.ok(calls.every(call => call.authorization === 'Bearer nim-test-key'));
  assert.equal(calls[0].body.stream, false);
});

test('NVIDIA NIM model override cannot select an unapproved non-free model', () => {
  process.env.NVIDIA_API_KEY = 'nim-test-key';
  process.env.NVIDIA_NIM_MODEL = 'some/paid-model';
  assert.equal(isFreeChainConfigured(), false);
  process.env.NVIDIA_NIM_MODEL = 'openai/gpt-oss-20b, z-ai/glm-5.3-flash';
  assert.equal(isFreeChainConfigured(), true);
});


test('NVIDIA NIM tries the secondary credential when the primary key is rejected', async () => {
  process.env.NVIDIA_API_KEY = 'nim-primary-test-key';
  process.env.NVIDIA_2_API_KEY = 'nim-secondary-test-key';
  const authHeaders: string[] = [];
  const models: string[] = [];
  const fetchImpl = (async (_url: any, init?: RequestInit) => {
    const auth = new Headers(init?.headers).get('authorization') || '';
    const model = JSON.parse(String(init?.body)).model;
    authHeaders.push(auth);
    models.push(model);
    if (auth === 'Bearer nim-primary-test-key') return new Response('{}', { status: 401 });
    return chatReply('Secondary NVIDIA key worked.');
  }) as typeof fetch;

  assert.equal(await generateFreeChainResponse('NIM secondary-key fallback', '', undefined, {}, fetchImpl), 'Secondary NVIDIA key worked.');
  assert.deepEqual(authHeaders, ['Bearer nim-primary-test-key', 'Bearer nim-secondary-test-key']);
  assert.deepEqual(models, ['openai/gpt-oss-20b', 'openai/gpt-oss-20b']);
});

