import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const routeUrl = new URL('../src/app/api/spmt/athena/commands/route.ts', import.meta.url);

test('SPMT Athena adapter validates bearer identity and reuses canonical tenant mapping', async () => {
  const source = await readFile(routeUrl, 'utf8');
  assert.match(source, /\/api\/oauth\/userinfo/);
  assert.match(source, /Authorization: `Bearer \$\{token\}`/);
  assert.match(source, /user\.twitchId, user\.twitch_id, user\.id/);
  assert.match(source, /context: 'voice'/);
  assert.match(source, /\/api\/ai\/chat-with-memory/);
  assert.match(source, /\/api\/tts/);
});

test('SPMT Athena adapter does not use deprecated cross-app secret headers', async () => {
  const source = await readFile(routeUrl, 'utf8');
  for (const deprecated of [
    'SYSTEM_API_KEY',
    'SPMT_API_KEY',
    'x-spmt-key',
    'x-bot-secret',
    'MOUNTAINVIEW_STREAMWEAVER_SECRET',
  ]) {
    assert.equal(source.includes(deprecated), false, `adapter must not use ${deprecated}`);
  }
});
