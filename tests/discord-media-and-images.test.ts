import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('Discord embeds keep the idle avatar in the thumbnail and selected lane GIF in the large image slot', async () => {
  const persistRoot = await mkdtemp(path.join(os.tmpdir(), 'streamweaver-discord-media-'));
  process.env.PERSIST_ROOT = persistRoot;
  process.env.STREAMWEAVER_PUBLIC_URL = 'https://streamweaver.test';

  try {
    const tokensDir = path.join(persistRoot, 'tenants', 'tenant-media', 'tokens');
    await mkdir(tokensDir, { recursive: true });
    await writeFile(path.join(tokensDir, 'user-config.json'), JSON.stringify({
      AI_BOT_NAME: 'MediaBot',
      PRIVATE_DM_GIF_URL: 'https://media.test/private.gif',
      PUBLIC_DISCORD_GIF_URL: 'https://media.test/public.gif',
    }));

    const { buildDiscordBotEmbed } = await import('../src/services/discord-branding');
    const privateEmbed = await buildDiscordBotEmbed({ description: 'private', tenantId: 'tenant-media', mediaSlot: 'private' });
    const publicEmbed = await buildDiscordBotEmbed({ description: 'public', tenantId: 'tenant-media', mediaSlot: 'public' });

    assert.match(privateEmbed.thumbnail.url, /\/api\/avatars\?type=idle&format=gif&tenant=tenant-media$/);
    assert.equal(privateEmbed.image?.url, 'https://media.test/private.gif');
    assert.match(publicEmbed.thumbnail.url, /\/api\/avatars\?type=idle&format=gif&tenant=tenant-media$/);
    assert.equal(publicEmbed.image?.url, 'https://media.test/public.gif');
  } finally {
    await rm(persistRoot, { recursive: true, force: true });
  }
});

test('image command preserves all requested durable image results', async () => {
  const persistRoot = await mkdtemp(path.join(os.tmpdir(), 'streamweaver-image-count-'));
  process.env.PERSIST_ROOT = persistRoot;
  const originalFetch = global.fetch;

  try {
    const settingsDir = path.join(persistRoot, 'tenants', 'tenant-images', 'data');
    await mkdir(settingsDir, { recursive: true });
    await writeFile(path.join(settingsDir, 'gen-settings.json'), JSON.stringify({
      mode: 'pollinations',
      optimizeImagePrompts: false,
      imageCount: 4,
    }));

    global.fetch = (async () => new Response(JSON.stringify({
      images: [1, 2, 3, 4].map((index) => `https://streamweaver.test/api/ai/image/file/${index}.png?tenantId=tenant-images`),
      provider: 'pollinations',
    }), { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch;

    const { runImageCommand } = await import('../src/services/image-command');
    const result = await runImageCommand('!img --count 4 a moonlit station', 'tenant-images');
    assert.equal(result.images.length, 4);
    assert.deepEqual(result.images.map((url) => new URL(url).pathname.split('/').pop()), ['1.png', '2.png', '3.png', '4.png']);
  } finally {
    global.fetch = originalFetch;
    await rm(persistRoot, { recursive: true, force: true });
  }
});

test('Perchance preserves every generated output up to the requested count', async () => {
  const originalFetch = global.fetch;
  try {
    global.fetch = (async () => new Response(JSON.stringify([
      'https://images.test/one.png',
      'https://images.test/two.png',
      'https://images.test/three.png',
      'https://images.test/four.png',
    ]), { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch;

    const { generateImageWithPerchance } = await import('../src/services/image-provider');
    const result = await generateImageWithPerchance({ prompt: 'four moons', numImages: 4 });
    assert.deepEqual(result.imageResourceUrls, [
      'https://images.test/one.png',
      'https://images.test/two.png',
      'https://images.test/three.png',
      'https://images.test/four.png',
    ]);
  } finally {
    global.fetch = originalFetch;
  }
});
