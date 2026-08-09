import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

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
