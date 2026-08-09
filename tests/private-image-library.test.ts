import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { serializeSessionCookie } from '../src/lib/session-cookie';

test('private image library returns all saved images newest first with Discord-fetchable URLs and safely deletes selected images', async () => {
  const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), 'streamweaver-private-library-'));
  const originalPersistRoot = process.env.PERSIST_ROOT;
  const originalNodeEnv = process.env.NODE_ENV;
  const originalAppUrl = process.env.APP_URL;
  process.env.PERSIST_ROOT = runtimeRoot;
  process.env.NODE_ENV = 'production';
  process.env.APP_URL = 'https://streamweaver.test';

  try {
    const { tenantPath } = await import('../src/lib/tenant');
    const dir = tenantPath('tenant-private-library', 'data/private-generated-images');
    await mkdir(dir, { recursive: true });

    const oldest = path.join(dir, '11111111-1111-1111-1111-111111111111.png');
    const middle = path.join(dir, '22222222-2222-2222-2222-222222222222.webp');
    const newest = path.join(dir, '33333333-3333-3333-3333-333333333333.jpg');
    await writeFile(oldest, 'oldest');
    await writeFile(middle, 'middle');
    await writeFile(newest, 'newest');
    await writeFile(path.join(dir, 'ignore.txt'), 'not an image');

    await utimes(oldest, new Date('2026-08-01T00:00:00Z'), new Date('2026-08-01T00:00:00Z'));
    await utimes(middle, new Date('2026-08-02T00:00:00Z'), new Date('2026-08-02T00:00:00Z'));
    await utimes(newest, new Date('2026-08-03T00:00:00Z'), new Date('2026-08-03T00:00:00Z'));

    const {
      deletePrivateGeneratedImage,
      listPrivateGeneratedImages,
      listPrivateGeneratedImageUrls,
    } = await import('../src/services/private-image-library');
    const images = await listPrivateGeneratedImages('tenant-private-library');
    const urls = await listPrivateGeneratedImageUrls('tenant-private-library');

    assert.deepEqual(images.map((entry) => entry.filename), [
      path.basename(newest),
      path.basename(middle),
      path.basename(oldest),
    ]);
    assert.equal(urls.length, 3);
    assert.match(urls[0], /^https:\/\/streamweaver\.test\/api\/ai\/image\/file\//);
    assert.match(urls[0], /tenantId=tenant-private-library/);
    assert.match(urls[0], /scope=private/);

    assert.equal(
      await deletePrivateGeneratedImage('tenant-private-library', path.basename(middle)),
      'deleted',
    );
    await assert.rejects(access(middle));
    assert.deepEqual(
      (await listPrivateGeneratedImages('tenant-private-library')).map((entry) => entry.filename),
      [path.basename(newest), path.basename(oldest)],
    );

    assert.equal(
      await deletePrivateGeneratedImage('tenant-private-library', '../11111111-1111-1111-1111-111111111111.png'),
      'invalid',
    );
    await access(oldest);
  } finally {
    if (originalPersistRoot === undefined) delete process.env.PERSIST_ROOT;
    else process.env.PERSIST_ROOT = originalPersistRoot;
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    if (originalAppUrl === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = originalAppUrl;
    await rm(runtimeRoot, { recursive: true, force: true });
  }
});

test('private gallery counts the active private-DM GIF and gives its owner a delete control', async () => {
  const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), 'streamweaver-private-active-gif-'));
  const originalPersistRoot = process.env.PERSIST_ROOT;
  const originalNodeEnv = process.env.NODE_ENV;
  const originalAppUrl = process.env.APP_URL;
  const originalSessionSecret = process.env.STREAMWEAVER_SESSION_SECRET;
  process.env.PERSIST_ROOT = runtimeRoot;
  process.env.NODE_ENV = 'production';
  process.env.APP_URL = 'https://streamweaver.test';
  process.env.STREAMWEAVER_SESSION_SECRET = 'private-library-test-secret';

  try {
    const tenantId = 'tenant-active-gif';
    const { writeDiscordMedia } = await import('../src/lib/discord-media-store');
    await writeDiscordMedia('private-dm', Buffer.from('GIF89a-active-private-slot'), tenantId);

    const { NextRequest } = await import('next/server');
    const { GET } = await import('../src/app/api/ai/image/library/route');
    const cookie = serializeSessionCookie({ id: tenantId, username: 'owner' });
    const request = new NextRequest(
      `https://streamweaver.test/api/ai/image/library?tenantId=${tenantId}&scope=private`,
      { headers: { cookie: `streamweaver-session=${cookie}` } },
    );
    const response = await GET(request);
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.match(html, /Saved GIFs \(<span id="gif-count">1<\/span>\)/);
    assert.match(html, /Private Generated Media \(<span id="media-count">1<\/span>\)/);
    assert.match(html, /✓ Active DM GIF/);
    assert.match(html, /data-delete-url="\/api\/discord-media\?slot=private-dm"/);
    assert.match(html, /\/api\/discord-media\/private-dm\.gif\?tenant=tenant-active-gif/);
  } finally {
    if (originalPersistRoot === undefined) delete process.env.PERSIST_ROOT;
    else process.env.PERSIST_ROOT = originalPersistRoot;
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    if (originalAppUrl === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = originalAppUrl;
    if (originalSessionSecret === undefined) delete process.env.STREAMWEAVER_SESSION_SECRET;
    else process.env.STREAMWEAVER_SESSION_SECRET = originalSessionSecret;
    await rm(runtimeRoot, { recursive: true, force: true });
  }
});

test('private gallery migrates the configured DSH-converted GIF over an older StreamWeaver slot', async () => {
  const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), 'streamweaver-private-dsh-migration-'));
  const originalPersistRoot = process.env.PERSIST_ROOT;
  const originalNodeEnv = process.env.NODE_ENV;
  const originalAppUrl = process.env.APP_URL;
  const originalDshUrl = process.env.DISCORD_STREAM_HUB_URL;
  const originalFetch = global.fetch;
  process.env.PERSIST_ROOT = runtimeRoot;
  process.env.NODE_ENV = 'production';
  process.env.APP_URL = 'https://streamweaver.test';
  process.env.DISCORD_STREAM_HUB_URL = 'https://discord-stream-hub-new.fly.dev';

  try {
    const tenantId = 'tenant-dsh-active';
    const dshUrl = `https://discord-stream-hub-new.fly.dev/api/media/streamweaver/${tenantId}/private-dm/current.gif`;
    const { tenantPath } = await import('../src/lib/tenant');
    const { writeDiscordMedia } = await import('../src/lib/discord-media-store');
    const { writeUserConfig, readUserConfigSync } = await import('../src/lib/user-config');
    await writeDiscordMedia('private-dm', Buffer.from('GIF89a-old-local-slot'), tenantId);
    await writeUserConfig({ PRIVATE_DM_GIF_URL: dshUrl }, tenantId);

    global.fetch = (async (input) => {
      assert.equal(String(input), dshUrl);
      return new Response(Buffer.from('GIF89a-current-dsh-converted'), {
        status: 200,
        headers: { 'content-type': 'image/gif' },
      });
    }) as typeof fetch;

    const { NextRequest } = await import('next/server');
    const { GET } = await import('../src/app/api/ai/image/library/route');
    const response = await GET(new NextRequest(
      `https://streamweaver.test/api/ai/image/library?tenantId=${tenantId}&scope=private`,
    ));
    const html = await response.text();
    const canonicalUrl = `https://streamweaver.test/api/discord-media/private-dm.gif?tenant=${tenantId}`;

    assert.equal(response.status, 200);
    assert.match(html, new RegExp(canonicalUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.doesNotMatch(html, /discord-stream-hub-new\.fly\.dev\/api\/media\/streamweaver/);
    assert.equal(readUserConfigSync(tenantId).PRIVATE_DM_GIF_URL, canonicalUrl);
    const canonicalFile = tenantPath(tenantId, 'data/discord-media/private-dm.gif');
    assert.equal((await readFile(canonicalFile)).toString(), 'GIF89a-current-dsh-converted');
  } finally {
    global.fetch = originalFetch;
    if (originalPersistRoot === undefined) delete process.env.PERSIST_ROOT;
    else process.env.PERSIST_ROOT = originalPersistRoot;
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    if (originalAppUrl === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = originalAppUrl;
    if (originalDshUrl === undefined) delete process.env.DISCORD_STREAM_HUB_URL;
    else process.env.DISCORD_STREAM_HUB_URL = originalDshUrl;
    await rm(runtimeRoot, { recursive: true, force: true });
  }
});

test('deleting the canonical private-DM slot removes the file and clears the active URL', async () => {
  const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), 'streamweaver-private-active-delete-'));
  const originalPersistRoot = process.env.PERSIST_ROOT;
  const originalNodeEnv = process.env.NODE_ENV;
  const originalAppUrl = process.env.APP_URL;
  const originalSessionSecret = process.env.STREAMWEAVER_SESSION_SECRET;
  process.env.PERSIST_ROOT = runtimeRoot;
  process.env.NODE_ENV = 'production';
  process.env.APP_URL = 'https://streamweaver.test';
  process.env.STREAMWEAVER_SESSION_SECRET = 'private-library-delete-secret';

  try {
    const tenantId = 'tenant-delete-active';
    const { writeDiscordMedia, readTenantDiscordMedia } = await import('../src/lib/discord-media-store');
    const { writeUserConfig, readUserConfigSync } = await import('../src/lib/user-config');
    await writeDiscordMedia('private-dm', Buffer.from('GIF89a-delete-me'), tenantId);
    await writeUserConfig({
      PRIVATE_DM_GIF_URL: `https://streamweaver.test/api/discord-media/private-dm.gif?tenant=${tenantId}`,
    }, tenantId);

    const { NextRequest } = await import('next/server');
    const { DELETE } = await import('../src/app/api/discord-media/route');
    const cookie = serializeSessionCookie({ id: tenantId, username: 'owner' });
    const response = await DELETE(new NextRequest(
      'https://streamweaver.test/api/discord-media?slot=private-dm',
      { method: 'DELETE', headers: { cookie: `streamweaver-session=${cookie}` } },
    ));

    assert.equal(response.status, 200);
    assert.equal(await readTenantDiscordMedia('private-dm', tenantId), null);
    assert.equal(Boolean(readUserConfigSync(tenantId).PRIVATE_DM_GIF_URL), false);
  } finally {
    if (originalPersistRoot === undefined) delete process.env.PERSIST_ROOT;
    else process.env.PERSIST_ROOT = originalPersistRoot;
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    if (originalAppUrl === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = originalAppUrl;
    if (originalSessionSecret === undefined) delete process.env.STREAMWEAVER_SESSION_SECRET;
    else process.env.STREAMWEAVER_SESSION_SECRET = originalSessionSecret;
    await rm(runtimeRoot, { recursive: true, force: true });
  }
});
