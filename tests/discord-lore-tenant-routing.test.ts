import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.cwd());
const patch = fs.readFileSync(path.join(root, 'scripts/patch-discord-lore-tenant-routing.mjs'), 'utf8');

test('unknown lore characters are only attached to tenants whose configured bot identity matches', () => {
  assert.match(patch, /const configuredNames = new Set/);
  assert.match(patch, /getBotName\(tenantId\)/);
  assert.match(patch, /AI_BOT_ALIASES/);
  assert.match(patch, /getBotAliases\(tenantId\)/);
  assert.match(patch, /character\.stableId\.startsWith\('unknown:'\)/);
  assert.match(patch, /loreNames\.some\(\(name\) => configuredNames\.has\(name\)\)/);
});
