import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

test('internal known-bots route requires service authentication and tenant scope', () => {
  const route = readFileSync(
    new URL('../src/app/api/internal/known-bots/route.ts', import.meta.url),
    'utf8',
  );

  assert.match(route, /hasInternalServiceAccess\(request\)/);
  assert.match(route, /username and tenantId are required/);
  assert.match(route, /addCustomBot\(username, tenantId\)/);
  assert.match(route, /alreadyBlacklisted: !added/);
});

test('middleware lets known-bots machine auth reach the route without requiring a human SPMT session', () => {
  const middleware = readFileSync(
    new URL('../src/middleware.ts', import.meta.url),
    'utf8',
  );

  assert.match(middleware, /'\/api\/internal\/known-bots'/);
  assert.match(middleware, /MACHINE_PATHS\.includes\(pathname\)/);
  assert.match(middleware, /Do not force a human SPMT/);
});

test('custom blacklist additions are idempotent', () => {
  const service = readFileSync(
    new URL('../src/services/known-bots.ts', import.meta.url),
    'utf8',
  );

  assert.match(service, /if \(custom\.has\(lower\)\) return false/);
  assert.match(service, /return true/);
});
