import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { after, before } from 'node:test';

let runtimeRoot = '';
before(async () => {
  runtimeRoot = await mkdtemp(path.join(os.tmpdir(), 'streamweaver-carousel-suite-'));
  process.env.PERSIST_ROOT = runtimeRoot;
});
after(async () => {
  await rm(runtimeRoot, { recursive: true, force: true });
});

test('private image carousel replaces stale GIF immediately, rotates, and replays', async () => {
  const originalControlSecret = process.env.PRIVATE_DM_CONTROL_SECRET;
  process.env.PRIVATE_DM_CONTROL_SECRET = 'test-private-dm-control-secret';
  const { registerPrivateImageCarousel, restartPrivateImageCarousel } = await import('../src/services/private-image-carousel');
  const images = ['https://images.example/one.png', 'https://images.example/two.png'];
  let message: any = {
    embeds: [{
      description: 'generated',
      image: { url: 'https://media.example/private.gif' },
      fields: [{ name: 'controls' }],
    }],
  };
  const seen: Array<string | null> = [];
  const dependencies = {
    intervalMs: 250,
    getMessage: async () => message,
    editMessage: async (_channelId: string, _messageId: string, payload: any) => {
      message = { ...message, ...payload };
      seen.push(payload.embeds[0].image?.url || null);
      return message;
    },
  } as any;

  try {
    assert.equal(await registerPrivateImageCarousel({
      tenantId: 'tenant-carousel-test',
      channelId: '1234567890123456789',
      messageId: '9876543210987654321',
      images,
    }, dependencies), true);

    assert.equal(seen[0], images[0]);
    assert.equal(message.embeds[0].image.url, images[0]);

    await new Promise((resolve) => setTimeout(resolve, 600));
    assert.deepEqual(seen, [images[0], images[1], images[1]]);
    assert.equal(message.embeds[0].fields.some((field: any) => String(field.value || '').includes('[🔄]')), true);

    seen.length = 0;
    assert.equal(await restartPrivateImageCarousel({
      tenantId: 'tenant-carousel-test',
      channelId: '1234567890123456789',
      messageId: '9876543210987654321',
    }, dependencies), true);
    assert.equal(seen[0], images[0]);
    await new Promise((resolve) => setTimeout(resolve, 600));
    assert.deepEqual(seen, [images[0], images[0], images[1], images[1]]);
  } finally {
    if (originalControlSecret === undefined) delete process.env.PRIVATE_DM_CONTROL_SECRET;
    else process.env.PRIVATE_DM_CONTROL_SECRET = originalControlSecret;
  }
});

test('single private image replaces stale GIF immediately without scheduling a fake rotation', async () => {
  const { registerPrivateImageCarousel } = await import('../src/services/private-image-carousel');
  const image = 'https://images.example/only.png';
  let message: any = { embeds: [{ description: 'generated', image: { url: 'https://media.example/private.gif' } }] };
  const seen: string[] = [];

  assert.equal(await registerPrivateImageCarousel({
    tenantId: 'tenant-carousel-single',
    channelId: '1234567890123456789',
    messageId: '9876543210987654321',
    images: [image],
  }, {
    intervalMs: 250,
    getMessage: async () => message,
    editMessage: async (_channelId: string, _messageId: string, payload: any) => {
      message = { ...message, ...payload };
      seen.push(payload.embeds[0].image?.url || '');
      return message;
    },
  } as any), true);

  assert.deepEqual(seen, [image]);
  await new Promise((resolve) => setTimeout(resolve, 350));
  assert.deepEqual(seen, [image]);
});

test('private image carousel persists all 90 saved gallery images instead of truncating to four', async () => {
  const { registerPrivateImageCarousel } = await import('../src/services/private-image-carousel');
  const { tenantPath } = await import('../src/lib/tenant');
  const images = Array.from({ length: 90 }, (_, index) => `https://images.example/library-${String(index + 1).padStart(2, '0')}.png`);
  let message: any = { embeds: [{ description: 'Private image library' }] };

  assert.equal(await registerPrivateImageCarousel({
    tenantId: 'tenant-carousel-library',
    channelId: '1234567890123456789',
    messageId: '9876543210987654321',
    images,
  }, {
    intervalMs: 60_000,
    getMessage: async () => message,
    editMessage: async (_channelId: string, _messageId: string, payload: any) => {
      message = { ...message, ...payload };
      return message;
    },
  } as any), true);

  assert.equal(message.embeds[0].image.url, images[0]);
  const store = JSON.parse(await readFile(
    tenantPath('tenant-carousel-library', 'data/private-image-carousels.json'),
    'utf8',
  ));
  const [record] = Object.values(store) as Array<{ images: string[] }>;
  assert.equal(record.images.length, 90);
  assert.deepEqual(record.images, images);
});
