import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { generateAIResponse } from '../src/services/ai-provider';
import { generateFreeGeminiResponse } from '../src/services/free-gemini-chat';
import { requestPrivateChatCompletion } from '../src/services/private-chat-ai';
import { AI_PAUSED_MESSAGE } from '../src/services/ai-cost-policy';

test('verified free Gemini serves public/private chat, blocks paid endpoints and bounds failure storms', async t => {
  const dir = mkdtempSync(path.join(tmpdir(), 'free-gemini-'));
  const policy = path.join(dir, 'policy.json');
  const oldPath = process.env.AI_COST_POLICY_PATH;
  const oldKey = process.env.GEMINI_API_KEY;
  process.env.AI_COST_POLICY_PATH = policy;
  process.env.GEMINI_API_KEY = 'unit-test-key-' + Date.now();
  t.after(() => {
    if (oldPath === undefined) delete process.env.AI_COST_POLICY_PATH; else process.env.AI_COST_POLICY_PATH = oldPath;
    if (oldKey === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = oldKey;
    rmSync(dir, { recursive: true, force: true });
  });
  let calls = 0;
  let status = 200;
  let blocked: Promise<void> | undefined;
  t.mock.method(globalThis, 'fetch', async (url: any, init?: RequestInit) => {
    calls++;
    assert.equal(String(url), 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent');
    assert.equal(new Headers(init?.headers).get('x-goog-api-key'), process.env.GEMINI_API_KEY);
    assert.equal(new Headers(init?.headers).has('authorization'), false);
    assert.equal(init?.redirect, 'error');
    const body = JSON.parse(String(init?.body));
    assert.ok(body.generationConfig.maxOutputTokens <= 1200);
    assert.ok(body.contents[0].parts[0].text.length <= 24_000);
    if (blocked) await blocked;
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [
      { text: 'private reasoning', thought: true }, { text: 'Hello from the free provider.' },
    ] } }] }), { status, headers: { 'content-type': 'application/json' } });
  });
  writeFileSync(policy, JSON.stringify({ paidRoutesEnabled: false }));
  assert.equal(await generateAIResponse('Hello'), AI_PAUSED_MESSAGE);
  assert.equal(calls, 0, 'having a key is not verification that its project is free');
  writeFileSync(policy, JSON.stringify({ paidRoutesEnabled: false, geminiFreeTierVerified: 'true' }));
  assert.equal(await generateAIResponse('Hello'), AI_PAUSED_MESSAGE);
  assert.equal(calls, 0);
  writeFileSync(policy, JSON.stringify({ paidRoutesEnabled: false, geminiFreeTierVerified: true }));
  assert.equal(await generateAIResponse('Hello'), 'Hello from the free provider.');
  assert.equal((await requestPrivateChatCompletion({ apiKey: 'unused-paid-key', prompt: 'Hello', systemPrompt: 'Be kind.' })).text, 'Hello from the free provider.');
  assert.equal(calls, 2, 'neither public nor private chat called a paid fallback');
  let release!: () => void;
  blocked = new Promise<void>(resolve => { release = resolve; });
  const active = generateFreeGeminiResponse('Long response');
  await assert.rejects(generateFreeGeminiResponse('Concurrent response'), { category: 'busy' });
  release();
  await active;
  blocked = undefined;
  status = 429;
  await assert.rejects(generateAIResponse('Quota'), { category: 'quota' });
  const callsAtQuota = calls;
  await Promise.all(Array.from({ length: 20 }, () => assert.rejects(generateAIResponse('Retry'), { category: 'quota' })));
  assert.equal(calls, callsAtQuota, 'quota cooldown prevents retry storms and paid fallback');
  process.env.GEMINI_API_KEY += '-replacement';
  status = 200;
  assert.equal(await generateAIResponse('New key'), 'Hello from the free provider.');
});
