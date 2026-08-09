import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { NextRequest } from 'next/server';

test('private image library delete route requires the owning StreamWeaver session', async () => {
  const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), 'streamweaver-private-library-route-'));
  const originalPersistRoot = process.env.PERSIST_ROOT;
  process.env.PERSIST_ROOT = runtimeRoot;

  try {
    const { tenantPath } = await import('../src/lib/tenant');
    const dir = tenantPath('tenant-delete-route', 'data/private-generated-images');
    await mkdir(dir, { recursive: true });
    const filename = '11111111-1111-1111-1111-111111111111.png';
    await writeFile(path.join(dir, filename), 'image');

    const { DELETE } = await import('../src/app/api/ai/image/library/route');
    const request = new NextRequest(
      `https://streamweaver.test/api/ai/image/library?tenantId=tenant-delete-route&scope=private&name=${filename}`,
      { method: 'DELETE' },
    );
    const response = await DELETE(request);

    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), {
      error: 'Sign in to StreamWeaver to delete images.',
    });
  } finally {
    if (originalPersistRoot === undefined) delete process.env.PERSIST_ROOT;
    else process.env.PERSIST_ROOT = originalPersistRoot;
    await rm(runtimeRoot, { recursive: true, force: true });
  }
});
