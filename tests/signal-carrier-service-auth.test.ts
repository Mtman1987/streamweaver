import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync('src/services/signal-carrier-sync.ts', 'utf8');

test('Signal carrier sync uses scoped SPMT service auth for ChatTag', () => {
  assert.match(source, /getSpmtServiceToken/);
  assert.match(source, /CHAT_TAG_BLACKLIST_SCOPE = 'chat-tag:blacklist:read'/);
  assert.match(source, /Authorization: `Bearer \$\{token\}`/);
});

test('Signal carrier sync refreshes a rejected service token once', () => {
  assert.match(source, /response\.status === 401/);
  assert.match(source, /clearSpmtServiceTokenCache\(\[CHAT_TAG_BLACKLIST_SCOPE\]\)/);
  assert.match(source, /fetchChatTagBlacklistAttempt\(token\)/);
});
