import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

function source(relative: string) {
  return fs.readFileSync(path.join(process.cwd(), relative), 'utf8');
}

test('StreamWeaver mints a scoped SPMT client-credentials token for entitlement reads', () => {
  const helper = source('src/lib/spmt-service-token.ts');
  assert.match(helper, /grant_type: 'client_credentials'/);
  assert.match(helper, /client_id: 'streamweaver'/);
  assert.match(helper, /STREAMWEAVER_CLIENT_SECRET/);
  assert.match(helper, /scope: key/);
  assert.match(helper, /scopes: grantedScopes\(payload, requested\)/);
});

test('service-token helper deduplicates mints and backs off repeated failures', () => {
  const helper = source('src/lib/spmt-service-token.ts');
  assert.match(helper, /const inFlight = new Map/);
  assert.match(helper, /const failures = new Map/);
  assert.match(helper, /FAILURE_BACKOFF_MS/);
  assert.match(helper, /TOKEN_TIMEOUT_MS = 3000/);
});

test('easter egg entitlement uses entitlements:read service bearer first', () => {
  const entitlement = source('src/lib/spmt-easter-eggs.ts');
  assert.match(entitlement, /getSpmtServiceToken\(\['entitlements:read'\]\)/);
  assert.match(entitlement, /Authorization: `Bearer \$\{token\}`/);
});

test('401 or 403 clears the rejected service token and retries the rollout fallback once', () => {
  const entitlement = source('src/lib/spmt-easter-eggs.ts');
  assert.match(entitlement, /response\.status === 401 \|\| response\.status === 403/);
  assert.match(entitlement, /clearSpmtServiceTokenCache\(\)/);
  assert.match(entitlement, /service-token-rejected-\$\{response\.status\}/);
  assert.match(entitlement, /legacyEntitlementRequest/);
});

test('legacy x-spmt-key remains rollout fallback with telemetry', () => {
  const entitlement = source('src/lib/spmt-easter-eggs.ts');
  assert.match(entitlement, /LEGACY_AUTH_USED migration=AUTH-SW-003/);
  assert.match(entitlement, /'x-spmt-key': LEGACY_SPMT_SYSTEM_KEY/);
});
