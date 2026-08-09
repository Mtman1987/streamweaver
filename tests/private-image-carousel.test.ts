import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('cycles one Discord embed, closes it, and replays from the picture control', async () => {
  const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), 'streamweaver-carousel-'));
  process.env.PERSIST_ROOT = runtimeRoot;
  const { registerPrivateImageCarousel, restartPrivateImageCarousel } = await import('../src/services/private-image-carousel');
  const images = ['https://images.example/one.png', 'https://images.example/two.png'];
  let message: any = { embeds: [{ description: 'generated', image: { url: images[0] }, fields: [{ name: 'controls' }] }] };
  const seen: Array<string | null> = [];
  const dependencies = {
    intervalMs: 12,
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
    await new Promise((resolve) => setTimeout(resolve, 45));
    assert.deepEqual(seen, [images[1], null]);
    assert.deepEqual(message.embeds[0].fields, [{ name: 'controls' }]);

    seen.length = 0;
    assert.equal(await restartPrivateImageCarousel({
      tenantId: 'tenant-carousel-test',
      channelId: '1234567890123456789',
      messageId: '9876543210987654321',
    }, dependencies), true);
    assert.equal(seen[0], images[0]);
    await new Promise((resolve) => setTimeout(resolve, 35));
    assert.deepEqual(seen, [images[0], images[1], null]);
  } finally {
    await rm(runtimeRoot, { recursive: true, force: true });
  }
});
