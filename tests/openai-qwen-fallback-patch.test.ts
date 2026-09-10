import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('live Adult Mode bridge defaults to a public OpenAI API model', () => {
  const patch = readFileSync(
    new URL('../scripts/patch-openai-qwen-fallback.mjs', import.meta.url),
    'utf8',
  );

  assert.match(patch, /process\.env\.OPENAI_CHAT_MODEL \|\| 'gpt-5-mini'/);
  assert.match(patch, /process\.env\.PRIVATE_OPENAI_MODEL \|\| process\.env\.OPENAI_CHAT_MODEL \|\| 'gpt-5-mini'/);
  assert.doesNotMatch(patch, /gpt-5\.6-luna/);
});
