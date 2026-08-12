import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.join(process.cwd());
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');

test('StreamWeaver consumes one canonical Personal renderer instead of rebuilding widgets', () => {
  const host = read('src/components/spmt-workspace-host.tsx');
  assert.match(host, /data-canonical-personal-overlay="true"/);
  assert.match(host, /src=\{personalOverlayUrl\}/);
  assert.doesNotMatch(host, /widgets\.map\(/);
  assert.doesNotMatch(host, /overlay\.widgets/);
  assert.match(host, /Personal overlay \{personalOverlayVisible \? 'On' : 'Off'\}/);
  assert.match(host, /Copy Public URL/);
  assert.match(host, /Copy Personal URL/);
  assert.match(host, /event\.altKey && event\.shiftKey && event\.key\.toLowerCase\(\) === 'f'/);
  assert.match(host, /footerVisible \? <aside/);
});

test('Personal renderer is proxied through the authenticated StreamWeaver SPMT session', () => {
  const themeRoute = read('src/app/api/spmt/workspace-theme/route.ts');
  const rendererRoute = read('src/app/tenant/[tenant]/personal/route.ts');
  const dataProxy = read('src/app/api/spmt/personal-render/[...path]/route.ts');
  const proxyHelper = read('src/lib/spmt-user-proxy.ts');

  assert.match(themeRoute, /api\/tenant-scene\?output=personal/);
  assert.match(themeRoute, /personalOverlayUrl: tenant \? `\/tenant\/\$\{encodeURIComponent\(tenant\)\}\/personal`/);
  assert.match(rendererRoute, /fetchSpmtForUser\(request, `\/tenant\/\$\{encodeURIComponent\(tenant\)\}\/personal`/);
  assert.match(rendererRoute, /personal-render\/tenant/);
  assert.match(rendererRoute, /personal-render\/cloud-xbox\/status/);
  assert.match(rendererRoute, /personal-render\/cloud-xbox\/frame/);
  assert.match(dataProxy, /Unsupported Personal render path/);
  assert.match(dataProxy, /parts\[0\] === 'cloud-xbox'/);
  assert.match(proxyHelper, /streamweaver-spmt-token/);
  assert.match(proxyHelper, /refreshSpmtConnection/);
  assert.doesNotMatch(rendererRoute, /access_token=|spmt_token=|Bearer \$\{/i);
});
