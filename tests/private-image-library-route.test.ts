import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { NextRequest } from 'next/server';

test('private image library delete route requires the owning StreamWeaver session', async () => {
  const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), 'streamweaver-private-library-route-'));
  const originalPersistRoot = process.env.PERSIST_ROOT;
  const originalSessionSecret = process.env.STREAMWEAVER_SESSION_SECRET;
  process.env.PERSIST_ROOT = runtimeRoot;
  process.env.STREAMWEAVER_SESSION_SECRET = 'private-image-library-route-test-secret';

  try {
    const { tenantPath } = await import('../src/lib/tenant');
    const { serializeSessionCookie } = await import('../src/lib/session-cookie');
    const dir = tenantPath('tenant-delete-route', 'data/private-generated-images');
    await mkdir(dir, { recursive: true });
    const filename = '11111111-1111-1111-1111-111111111111.png';
    const imagePath = path.join(dir, filename);
    await writeFile(imagePath, 'image');

    const { DELETE } = await import('../src/app/api/ai/image/library/route');
    const url = `https://streamweaver.test/api/ai/image/library?tenantId=tenant-delete-route&scope=private&name=${filename}`;

    const unauthenticated = await DELETE(new NextRequest(url, { method: 'DELETE' }));
    assert.equal(unauthenticated.status, 401);
    assert.deepEqual(await unauthenticated.json(), {
      error: 'Sign in to StreamWeaver to delete images.',
    });
    await access(imagePath);

    const wrongTenantCookie = serializeSessionCookie({ id: 'different-tenant', username: 'wrong-owner' });
    const forbidden = await DELETE(new NextRequest(url, {
      method: 'DELETE',
      headers: { cookie: `streamweaver-session=${wrongTenantCookie}` },
    }));
    assert.equal(forbidden.status, 403);
    assert.deepEqual(await forbidden.json(), {
      error: 'You can only delete images from your own library.',
    });
    await access(imagePath);

    const ownerCookie = serializeSessionCookie({ id: 'tenant-delete-route', username: 'owner' });
    const deleted = await DELETE(new NextRequest(url, {
      method: 'DELETE',
      headers: { cookie: `streamweaver-session=${ownerCookie}` },
    }));
    assert.equal(deleted.status, 200);
    assert.deepEqual(await deleted.json(), { ok: true, deleted: filename });
    await assert.rejects(access(imagePath));
  } finally {
    if (originalPersistRoot === undefined) delete process.env.PERSIST_ROOT;
    else process.env.PERSIST_ROOT = originalPersistRoot;
    if (originalSessionSecret === undefined) delete process.env.STREAMWEAVER_SESSION_SECRET;
    else process.env.STREAMWEAVER_SESSION_SECRET = originalSessionSecret;
    await rm(runtimeRoot, { recursive: true, force: true });
  }
});
