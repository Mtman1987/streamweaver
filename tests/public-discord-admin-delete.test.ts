import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('public AI delete allows SPMT admins without broadening other public controls', () => {
  const route = readFileSync(
    new URL('../src/app/api/discord/control/route.ts', import.meta.url),
    'utf8',
  );
  assert.match(route, /canDeletePublicReply/);
  assert.match(route, /getSpmtDiscordIdentity/);
  assert.match(route, /spmtIdentity\?\.isAdmin === true/);
  assert.match(route, /if \(action === 'delete'\)/);
  assert.match(route, /else if \(!requireOwningTenant\(request, control\.tenantId\)\)/);
  assert.match(route, /PUBLIC_DELETE_FORBIDDEN/);
});

test('private Discord delete remains sender-owned and unchanged', () => {
  const privateRoute = readFileSync(
    new URL('../src/app/api/private-chat/control/route.ts', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(privateRoute, /getSpmtDiscordIdentity|PUBLIC_DELETE_FORBIDDEN|canDeletePublicReply/);
});

test('SPMT userinfo exposes the same admin role semantics used across the ecosystem', () => {
  const userinfo = readFileSync(new URL('../src/lib/spmt-userinfo.ts', import.meta.url), 'utf8');
  assert.match(userinfo, /isAdmin: boolean/);
  assert.match(userinfo, /user\?\.isAdmin === true/);
  assert.match(userinfo, /role === 'admin' \|\| role === 'owner'/);
  assert.match(userinfo, /roles\.includes\('admin'\) \|\| roles\.includes\('owner'\)/);
});
