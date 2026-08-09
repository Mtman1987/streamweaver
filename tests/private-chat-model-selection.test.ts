import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { NextRequest } from 'next/server';

process.env.STREAMWEAVER_SESSION_SECRET = 'private-model-selection-test-secret';
process.env.APP_URL = 'https://streamweaver-new.fly.dev';

test('private settings exposes advertised models and the effective auto-selected runtime model', async () => {
  const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), 'streamweaver-private-model-'));
  const originalPersistRoot = process.env.PERSIST_ROOT;
  const originalFetch = globalThis.fetch;
  process.env.PERSIST_ROOT = runtimeRoot;

  try {
    const { clearQwenModelCapabilityCacheForTests } = await import('../src/services/qwen-quality');
    const { serializeSessionCookie } = await import('../src/lib/session-cookie');
    clearQwenModelCapabilityCacheForTests();

    globalThis.fetch = (async (input: string | URL | Request) => {
      assert.equal(String(input), 'http://spmt-llm-worker.internal:8080/v1/models');
      return new Response(JSON.stringify({
        data: [
          { id: 'spmt-qwen3-4b' },
          { id: 'spmt-qwen3-8b' },
          { id: 'spmt-qwen3-14b' },
        ],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;

    const cookie = serializeSessionCookie({ id: 'tenant-model-ui', username: 'owner' });
    const headers = { cookie: `streamweaver-session=${cookie}` };
    const { GET, POST } = await import('../src/app/api/private-chat/settings/route');

    const getResponse = await GET(new NextRequest('https://streamweaver-new.fly.dev/api/private-chat/settings', { headers }));
    assert.equal(getResponse.status, 200);
    const getPayload = await getResponse.json();
    const getSettings = getPayload.settings || getPayload.data?.settings;
    assert.deepEqual(getSettings.availableQwenModels, [
      'spmt-qwen3-4b',
      'spmt-qwen3-8b',
      'spmt-qwen3-14b',
    ]);
    assert.equal(getSettings.configuredQwenModel, 'spmt-qwen3-4b');
    assert.equal(getSettings.effectiveQwenModel, 'spmt-qwen3-14b');
    assert.equal(getSettings.qwenAutoSelectEnabled, true);
    assert.equal(getSettings.qwenModelDiscoveryAvailable, true);

    const postResponse = await POST(new NextRequest('https://streamweaver-new.fly.dev/api/private-chat/settings', {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ qwenModel: 'spmt-qwen3-8b' }),
    }));
    assert.equal(postResponse.status, 200);
    const postPayload = await postResponse.json();
    const postSettings = postPayload.settings || postPayload.data?.settings;
    assert.equal(postSettings.configuredQwenModel, 'spmt-qwen3-8b');
    assert.equal(postSettings.effectiveQwenModel, 'spmt-qwen3-8b');
    assert.equal(postSettings.qwenAutoSelectEnabled, false);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalPersistRoot === undefined) delete process.env.PERSIST_ROOT;
    else process.env.PERSIST_ROOT = originalPersistRoot;
    await rm(runtimeRoot, { recursive: true, force: true });
  }
});

test('private chat UI shows effective runtime model and a model selector', () => {
  const source = readFileSync(
    new URL('../src/app/(app)/private-chat/page.tsx', import.meta.url),
    'utf8',
  );

  assert.match(source, /Effective runtime model:/);
  assert.match(source, /Model selection/);
  assert.match(source, /Auto — best available/);
  assert.match(source, /availableQwenModels/);
  assert.match(source, /effectiveQwenModel/);
  assert.match(source, /onChange=\{\(event\) => void setQwenModel\(event\.target\.value\)\}/);
});
