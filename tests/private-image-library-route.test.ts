import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { NextRequest } from 'next/server';

async function withPrivateLibraryRuntime(run: (runtimeRoot: string) => Promise<void>) {
  const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), 'streamweaver-private-library-route-'));
  const originalPersistRoot = process.env.PERSIST_ROOT;
  const originalSessionSecret = process.env.STREAMWEAVER_SESSION_SECRET;
  const originalAppUrl = process.env.APP_URL;
  process.env.PERSIST_ROOT = runtimeRoot;
  process.env.STREAMWEAVER_SESSION_SECRET = 'private-image-library-route-test-secret';
  process.env.APP_URL = 'https://streamweaver.test';

  try {
    await run(runtimeRoot);
  } finally {
    if (originalPersistRoot === undefined) delete process.env.PERSIST_ROOT;
    else process.env.PERSIST_ROOT = originalPersistRoot;
    if (originalSessionSecret === undefined) delete process.env.STREAMWEAVER_SESSION_SECRET;
    else process.env.STREAMWEAVER_SESSION_SECRET = originalSessionSecret;
    if (originalAppUrl === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = originalAppUrl;
    await rm(runtimeRoot, { recursive: true, force: true });
  }
}

test('private image library delete route requires the owning StreamWeaver session', async () => {
  await withPrivateLibraryRuntime(async () => {
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
  });
});

test('private library renders a separate saved GIF section with owner Apply controls', async () => {
  await withPrivateLibraryRuntime(async () => {
    const { tenantPath } = await import('../src/lib/tenant');
    const { serializeSessionCookie } = await import('../src/lib/session-cookie');
    const dir = tenantPath('tenant-gallery-route', 'data/private-generated-images');
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'saved-image.png'), 'image');
    await writeFile(path.join(dir, 'saved-animation.gif'), 'gif');

    const ownerCookie = serializeSessionCookie({ id: 'tenant-gallery-route', username: 'owner' });
    const { GET } = await import('../src/app/api/ai/image/library/route');
    const response = await GET(new NextRequest(
      'https://streamweaver.test/api/ai/image/library?tenantId=tenant-gallery-route&scope=private',
      { headers: { cookie: `streamweaver-session=${ownerCookie}` } },
    ));
    const html = await response.text();

    assert.match(html, /Generated Images/);
    assert.match(html, /Saved GIFs/);
    assert.match(html, /saved-animation\.gif/);
    assert.match(html, /data-apply-gif="saved-animation\.gif"/);
    assert.match(html, />Apply to DM</);
    assert.match(html, /data-delete-url=/);
  });
});

test('applying a saved GIF requires ownership and switches the active private DM media slot', async () => {
  await withPrivateLibraryRuntime(async () => {
    const { tenantPath } = await import('../src/lib/tenant');
    const { serializeSessionCookie } = await import('../src/lib/session-cookie');
    const { readUserConfig } = await import('../src/lib/user-config');
    const { readPrivateChatSettings } = await import('../src/lib/private-chat-settings-store');
    const tenantId = 'tenant-apply-gif';
    const dir = tenantPath(tenantId, 'data/private-generated-images');
    await mkdir(dir, { recursive: true });
    const gifBytes = Buffer.from('GIF89a-saved-test');
    await writeFile(path.join(dir, 'favorite.gif'), gifBytes);

    const { POST } = await import('../src/app/api/ai/image/library/route');
    const url = 'https://streamweaver.test/api/ai/image/library';
    const requestBody = JSON.stringify({
      tenantId,
      scope: 'private',
      name: 'favorite.gif',
      action: 'apply-gif',
    });

    const unauthenticated = await POST(new NextRequest(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: requestBody,
    }));
    assert.equal(unauthenticated.status, 401);

    const wrongCookie = serializeSessionCookie({ id: 'wrong-tenant', username: 'wrong' });
    const forbidden = await POST(new NextRequest(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: `streamweaver-session=${wrongCookie}` },
      body: requestBody,
    }));
    assert.equal(forbidden.status, 403);

    const ownerCookie = serializeSessionCookie({ id: tenantId, username: 'owner' });
    const applied = await POST(new NextRequest(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: `streamweaver-session=${ownerCookie}` },
      body: requestBody,
    }));
    assert.equal(applied.status, 200);
    const payload = await applied.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.applied, 'favorite.gif');
    assert.match(payload.url, /\/api\/discord-media\/private-dm\.gif\?tenant=tenant-apply-gif$/);

    const activeGif = await readFile(tenantPath(tenantId, 'data/discord-media/private-dm.gif'));
    assert.deepEqual(activeGif, gifBytes);
    const config = await readUserConfig(tenantId);
    assert.equal(config.PRIVATE_DM_GIF_URL, payload.url);
    const settings = await readPrivateChatSettings(tenantId);
    assert.equal(settings.gifEnabled, true);
  });
});
