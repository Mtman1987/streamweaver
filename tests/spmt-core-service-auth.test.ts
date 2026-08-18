import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const source = fs.readFileSync(path.join(process.cwd(), 'src/lib/spmt-client.ts'), 'utf8');

test('StreamWeaver uses its existing SPMT service token helper for events and owner recovery', () => {
  assert.match(source, /getSpmtServiceToken\(\[scope\]\)/);
  assert.match(source, /fetchSpmtWithServiceAuth/);
  assert.match(source, /'events:write'/);
  assert.match(source, /'account-recovery:write'/);
  assert.match(source, /clearSpmtServiceTokenCache\(\)/);
});

test('legacy StreamWeaver keys remain rollout fallbacks rather than primary auth', () => {
  assert.match(source, /LEGACY_AUTH_USED caller=streamweaver scope=\$\{scope\}/);
  assert.match(source, /SPMT_API_KEY \? \{ Authorization:/);
  assert.match(source, /SPMT_SYSTEM_KEY \? \{ 'x-spmt-key': SPMT_SYSTEM_KEY \}/);
  assert.match(source, /Boolean\(STREAMWEAVER_CLIENT_SECRET \|\| SPMT_API_KEY\)/);
});
