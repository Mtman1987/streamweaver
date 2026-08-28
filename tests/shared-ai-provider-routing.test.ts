import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const directEdenChat = /api\.edenai\.run\/v3\/chat\/completions/;
const legacyEdenChat = /api\.edenai\.run\/v3\/llm\/chat\/completions/;
const sharedAiCallers = [
  '../src/app/api/ai/chat-with-memory/route.ts',
  '../src/app/api/ai/optimize-personality/route.ts',
  '../src/app/api/private-ltm/condense/route.ts',
  '../src/ai/flows/shoutout-ai.ts',
  '../src/services/shoutout-matcher.ts',
];

test('all normal text-AI callers use the shared provider', () => {
  for (const relativePath of sharedAiCallers) {
    const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8');
    assert.match(source, /generateAIResponse/);
    assert.doesNotMatch(source, directEdenChat);
  }
});

test('only the shared AI provider owns the EdenAI text endpoint', () => {
  const provider = readFileSync(new URL('../src/services/ai-provider.ts', import.meta.url), 'utf8');
  assert.match(provider, /requestSpmtLocalLlm/);
  assert.match(provider, /generateEdenAIFallbackResponse/);
  assert.match(provider, directEdenChat);
  assert.doesNotMatch(provider, legacyEdenChat);
});

test('the shared provider repairs incomplete completions instead of returning cut-off bot replies', () => {
  const provider = readFileSync(new URL('../src/services/ai-provider.ts', import.meta.url), 'utf8');
  const memoryChat = readFileSync(new URL('../src/app/api/ai/chat-with-memory/route.ts', import.meta.url), 'utf8');

  assert.match(provider, /finish_reason/);
  assert.match(provider, /looksIncompleteCompletion/);
  assert.match(provider, /requesting continuation/);
  assert.match(provider, /Continue exactly where your previous answer stopped/);
  assert.match(provider, /EdenAI returned an incomplete response after/);
  assert.match(memoryChat, /Never end mid-sentence or with a dangling ellipsis/);
  assert.match(memoryChat, /maxCharacters:\s*context === 'discord'/);
});

test('EdenAI is primary and local Qwen is fallback when EdenAI fails', () => {
  const provider = readFileSync(new URL('../src/services/ai-provider.ts', import.meta.url), 'utf8');
  const local = readFileSync(new URL('../src/services/spmt-local-llm.ts', import.meta.url), 'utf8');
  assert.match(local, /SPMT_LOCAL_LLM_ENABLED !== 'false'/);
  const edenCall = provider.indexOf('await generateEdenAIFallbackResponse(');
  const qwenCall = provider.indexOf('await requestSpmtLocalLlm(');
  assert.ok(edenCall >= 0, 'EdenAI primary call is missing');
  assert.ok(qwenCall >= 0, 'Qwen fallback call is missing');
  assert.ok(edenCall < qwenCall, 'EdenAI must be attempted before Qwen');
  assert.match(provider, /EdenAI primary failed/);
  assert.match(provider, /falling back to local Qwen/);
});
