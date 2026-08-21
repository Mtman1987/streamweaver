import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { looksAbruptlyCutOff } from '../src/services/spmt-local-llm';

const directEdenChat = /api\.edenai\.run\/v3\/llm\/chat\/completions/;
const sharedAiCallers = [
  '../src/app/api/ai/chat-with-memory/route.ts',
  '../src/app/api/ai/optimize-personality/route.ts',
  '../src/app/api/private-ltm/condense/route.ts',
  '../src/ai/flows/shoutout-ai.ts',
  '../src/services/shoutout-matcher.ts',
];

test('all normal text-AI callers use the shared local-first provider', () => {
  for (const relativePath of sharedAiCallers) {
    const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8');
    assert.match(source, /generateAIResponse/);
    assert.doesNotMatch(source, directEdenChat);
  }
});

test('only the shared AI provider owns the EdenAI text fallback endpoint', () => {
  const provider = readFileSync(new URL('../src/services/ai-provider.ts', import.meta.url), 'utf8');
  assert.match(provider, /requestSpmtLocalLlm/);
  assert.match(provider, /generateEdenAIFallbackResponse/);
  assert.match(provider, directEdenChat);
});

test('shared local model is enabled by default and falls back only after failure', () => {
  const provider = readFileSync(new URL('../src/services/ai-provider.ts', import.meta.url), 'utf8');
  const local = readFileSync(new URL('../src/services/spmt-local-llm.ts', import.meta.url), 'utf8');
  assert.match(local, /SPMT_LOCAL_LLM_ENABLED !== 'false'/);
  assert.match(provider, /if \(isSpmtLocalLlmEnabled\(\) && !localLlmCircuitIsOpen\(\)\)/);
  assert.match(provider, /catch \(error\)/);
  assert.match(provider, /falling back to EdenAI/);
});

test('shared local model detects visibly incomplete replies before they reach Discord', () => {
  assert.equal(looksAbruptlyCutOff('Athena remembers the number was 42.', 'stop'), false);
  assert.equal(looksAbruptlyCutOff('Athena remembers the number was', 'length'), true);
  assert.equal(looksAbruptlyCutOff('Athena remembers the number was about', 'stop'), true);
  assert.equal(looksAbruptlyCutOff('Use the ` character when needed.', 'stop'), false);
  assert.equal(looksAbruptlyCutOff('```text\nunfinished', 'stop'), true);
});

test('shared local model retries truncated generations without ignoring the caller token cap', () => {
  const local = readFileSync(new URL('../src/services/spmt-local-llm.ts', import.meta.url), 'utf8');
  assert.match(local, /looksAbruptlyCutOff\(first\.text, first\.finishReason\)/);
  assert.match(local, /const retryBudget = maxTokens\(requestedBudget \* 2\)/);
  assert.doesNotMatch(local, /Math\.max\(requestedBudget \* 2, 800\)/);
  assert.match(local, /The previous draft ended abruptly before the answer was complete/);
  assert.match(local, /throw new Error\(`SPMT local LLM returned an incomplete response/);
});
