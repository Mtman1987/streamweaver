import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('Companion bootstrap validates SPMT identity and issues a tenant-scoped StreamWeaver session', () => {
  const route = fs.readFileSync(path.join(root, 'src/app/api/auth/companion/bootstrap/route.ts'), 'utf8');
  assert.match(route, /Authorization: `Bearer \$\{token\}`/);
  assert.match(route, /SPMT_BASE_URL.*\/api\/me/);
  assert.match(route, /bootstrapTenant\(tenantId, username\)/);
  assert.match(route, /identityProvider: 'spmt-companion'/);
  assert.match(route, /'streamweaver-session'/);
  assert.match(route, /httpOnly: true/);
  assert.match(route, /sameSite: 'lax'/);
  assert.doesNotMatch(route, /console\.(log|info|warn|error).*token/);
});
