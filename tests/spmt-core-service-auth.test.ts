import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const client = fs.readFileSync(path.join(process.cwd(), 'src/lib/spmt-client.ts'), 'utf8');
const tokens = fs.readFileSync(path.join(process.cwd(), 'src/lib/spmt-service-token.ts'), 'utf8');

test('StreamWeaver uses its existing SPMT service token helper for events and owner recovery', () => {
  assert.match(client, /getSpmtServiceToken\(\[scope\]\)/);
  assert.match(client, /fetchSpmtWithServiceAuth/);
  assert.match(client, /'events:write'/);
  assert.match(client, /'account-recovery:write'/);
  assert.match(client, /clearSpmtServiceTokenCache\(\[scope\]\)/);
});

test('each service request attempt receives a fresh timeout budget', () => {
  assert.match(client, /function attemptSignal\(timeoutMs: number\)/);
  assert.match(client, /fetchSpmtAttempt/);
  assert.match(client, /signal: attemptSignal\(timeoutMs\)/);
  assert.doesNotMatch(client, /signal: typeof AbortSignal[^]*AbortSignal\.timeout\(5000\)/);
});

test('403 authorization denials never escalate into legacy credentials', () => {
  assert.match(client, /if \(response\.status === 403\) return response/);
  assert.match(client, /if \(response\.status === 401\)/);
  assert.match(client, /await discardResponse\(response\)/);
});

test('service token cache is isolated by normalized scope set', () => {
  assert.match(tokens, /const cached = new Map<string, ServiceTokenCache>\(\)/);
  assert.match(tokens, /const key = scopeKey\(requested\)/);
  assert.match(tokens, /cached\.get\(key\)/);
  assert.match(tokens, /cached\.set\(key, entry\)/);
  assert.match(tokens, /clearSpmtServiceTokenCache\(scopes\?: string\[\]\)/);
});

test('legacy StreamWeaver keys remain rollout fallbacks rather than primary auth', () => {
  assert.match(client, /LEGACY_AUTH_USED caller=streamweaver scope=\$\{scope\} reason=service-auth-unavailable/);
  assert.match(client, /SPMT_API_KEY \? \{ Authorization:/);
  assert.match(client, /SPMT_SYSTEM_KEY \? \{ 'x-spmt-key': SPMT_SYSTEM_KEY \}/);
  assert.match(client, /Boolean\(STREAMWEAVER_CLIENT_SECRET \|\| SPMT_API_KEY \|\| SPMT_SYSTEM_KEY\)/);
});
