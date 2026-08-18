import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const routeUrl = new URL('../src/app/api/spmt/bot/commands/route.ts', import.meta.url);

test('SPMT bot adapter validates bearer identity and reuses canonical tenant mapping', async () => {
  const source = await readFile(routeUrl, 'utf8');
  assert.match(source, /\/api\/oauth\/userinfo/);
  assert.match(source, /Authorization: `Bearer \$\{token\}`/);
  assert.match(source, /user\.twitchId, user\.twitch_id, user\.id/);
  assert.match(source, /context: isGuestBot \? 'discord-cross-bot' : 'voice'/);
  assert.match(source, /\/api\/ai\/chat-with-memory/);
  assert.match(source, /\/api\/tts/);
});

test('SPMT bot adapter uses HTTP loopback for same-process internal API hops', async () => {
  const source = await readFile(routeUrl, 'utf8');
  assert.match(source, /function internalBaseUrl\(\): string/);
  assert.match(source, /http:\/\/127\.0\.0\.1:\$\{port\}/);
  assert.match(source, /new URL\(path, internalBaseUrl\(\)\)/);
  assert.equal(source.includes('new URL(path, request.nextUrl.origin)'), false);
});

test('SPMT bot adapter carries signed tenant context through internal API hops', async () => {
  const source = await readFile(routeUrl, 'utf8');
  assert.match(source, /async function postInternal\(_request: NextRequest, path: string, cookie: string, token: string, body: unknown\)/);
  assert.match(source, /headers: \{[\s\S]*?Authorization: `Bearer \$\{token\}`,[\s\S]*?Cookie: cookie,[\s\S]*?\}/);
  assert.match(source, /postInternal\(request, '\/api\/ai\/chat-with-memory', session\.header, token,/);
  assert.match(source, /postInternal\(request, '\/api\/tts', cookie, token,/);
});

test('SPMT bot adapter does not use deprecated cross-app secret headers', async () => {
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
