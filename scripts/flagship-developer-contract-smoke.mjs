import assert from 'node:assert/strict';
import fs from 'node:fs';

const manifestSource = fs.readFileSync('src/app/api/platform/manifest/route.ts', 'utf8');
const healthSource = fs.readFileSync('src/app/api/health/route.ts', 'utf8');

for (const marker of [
  "manifestVersion: 'spmt.app-manifest/v1'",
  "id: 'streamweaver'",
  "healthUrl: 'https://streamweaver-new.fly.dev/api/health'",
  "sdkPackage: '@spmt/sdk'",
  "eventOwner: 'streamweaver'",
  'tenantIsolation: true',
]) {
  assert.ok(manifestSource.includes(marker), `missing manifest marker: ${marker}`);
}

for (const capability of ['automation', 'commands', 'ai-runtime', 'tts', 'shared-chat', 'overlays', 'pokemon', 'signal', 'companion']) {
  assert.ok(manifestSource.includes(`'${capability}'`), `missing capability: ${capability}`);
}

assert.match(healthSource, /manifestVersion:\s*'spmt\.app-manifest\/v1'/);
assert.match(healthSource, /manifestUrl:\s*'\/api\/platform\/manifest'/);

console.log('StreamWeaver flagship developer contract passed.');
