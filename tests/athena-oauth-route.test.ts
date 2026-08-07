import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';

function request(headers: Record<string, string>, message = 'what can you do?') {
  return new NextRequest('http://localhost/api/athena/respond', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({
      tenantId: 'client-claimed-tenant',
      message,
      actor: {
        userId: 'client-claimed-user',
        username: 'client-claimed-name',
        displayName: 'Client Claimed Name',
        isOwner: true,
        isAdmin: true,
      },
      location: {
        app: 'fly-machine-rotator',
        surface: 'rotator-workbench',
        layout: 'athena-llm-workbench',
        live: false,
        replyMode: 'structured',
      },
    }),
  });
}

test('canonical Athena uses verified SPMT OAuth and rejects invented master-key or marker-only access', async () => {
  const persistRoot = await mkdtemp(path.join(os.tmpdir(), 'streamweaver-athena-oauth-'));
  const originalFetch = global.fetch;
  const previousPersistRoot = process.env.PERSIST_ROOT;
  const previousSpmtKey = process.env.SPMT_API_KEY;
  const previousSpmtPlatformKey = process.env.SPMT_PLATFORM_API_KEY;
  const previousBotKey = process.env.BOT_SECRET_KEY;
  const previousStreamWeaverKey = process.env.STREAMWEAVER_SECRET;

  process.env.PERSIST_ROOT = persistRoot;
  process.env.SPMT_API_KEY = 'not-an-oauth-token';
  process.env.SPMT_PLATFORM_API_KEY = 'also-not-an-oauth-token';
  delete process.env.BOT_SECRET_KEY;
  delete process.env.STREAMWEAVER_SECRET;

  global.fetch = (async (_input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const authorization = new Headers(init?.headers).get('authorization') || '';
    if (authorization === 'Bearer real-spmt-oauth-token') {
      return new Response(JSON.stringify({
        user: {
          id: 'spmt-user-1',
          username: 'space-user',
          displayName: 'Space User',
          twitchId: '94371378',
          twitchUsername: 'mtman1987',
          role: 'owner',
          isAdmin: true,
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify({ error: 'invalid token' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;

  try {
    const { POST } = await import('../src/app/api/athena/respond/route');

    const inventedKey = await POST(request({ authorization: 'Bearer not-an-oauth-token' }));
    assert.equal(inventedKey.status, 401);

    const markerOnly = await POST(request({ 'x-mountainview-bridge': '1' }));
    assert.equal(markerOnly.status, 401);

    const valid = await POST(request({ authorization: 'Bearer real-spmt-oauth-token' }));
    assert.equal(valid.status, 200);
    const payload = await valid.json();
    assert.equal(payload.visibility, 'private');
    assert.equal(payload.surface, 'rotator-workbench');
    assert.match(String(payload.response || ''), /Private commands work even when the streamer is offline/i);

    const memoryPath = path.join(
      persistRoot,
      'tenants',
      '94371378',
      'data',
      'athena',
      'memory.json',
    );
    const memories = JSON.parse(await readFile(memoryPath, 'utf8')) as Array<Record<string, any>>;
    assert.ok(memories.length >= 2);
    assert.ok(memories.some((entry) => Array.isArray(entry.participants) && entry.participants.includes('mtman1987')));
    assert.equal(memories.some((entry) => Array.isArray(entry.participants) && entry.participants.includes('client-claimed-name')), false);
  } finally {
    global.fetch = originalFetch;
    if (previousPersistRoot === undefined) delete process.env.PERSIST_ROOT;
    else process.env.PERSIST_ROOT = previousPersistRoot;
    if (previousSpmtKey === undefined) delete process.env.SPMT_API_KEY;
    else process.env.SPMT_API_KEY = previousSpmtKey;
    if (previousSpmtPlatformKey === undefined) delete process.env.SPMT_PLATFORM_API_KEY;
    else process.env.SPMT_PLATFORM_API_KEY = previousSpmtPlatformKey;
    if (previousBotKey === undefined) delete process.env.BOT_SECRET_KEY;
    else process.env.BOT_SECRET_KEY = previousBotKey;
    if (previousStreamWeaverKey === undefined) delete process.env.STREAMWEAVER_SECRET;
    else process.env.STREAMWEAVER_SECRET = previousStreamWeaverKey;
    await rm(persistRoot, { recursive: true, force: true });
  }
});
