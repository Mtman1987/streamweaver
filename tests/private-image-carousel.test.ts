import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('private image carousel replaces stale GIF immediately, rotates, and replays', async () => {
  const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), 'streamweaver-carousel-'));
  process.env.PERSIST_ROOT = runtimeRoot;
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

    // Registration owns the frame immediately instead of waiting for the timer.
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
    await rm(runtimeRoot, { recursive: true, force: true });
  }
});

test('single private image replaces stale GIF immediately without scheduling a fake rotation', async () => {
  const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), 'streamweaver-carousel-single-'));
  process.env.PERSIST_ROOT = runtimeRoot;
  const { registerPrivateImageCarousel } = await import('../src/services/private-image-carousel');
  const image = 'https://images.example/only.png';
  let message: any = { embeds: [{ description: 'generated', image: { url: 'https://media.example/private.gif' } }] };
  const seen: string[] = [];

  try {
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
  } finally {
    await rm(runtimeRoot, { recursive: true, force: true });
  }
});
