import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
    const avatarDir = path.join(persistRoot, 'tenants', 'tenant-media', 'data', 'avatars');
    await mkdir(avatarDir, { recursive: true });
    await writeFile(path.join(avatarDir, 'idle.gif'), await readFile(path.join(process.cwd(), 'public', 'avatars', 'idle.gif')));

    const { buildDiscordBotEmbed } = await import('../src/services/discord-branding');
    const {
      DISCORD_AVATAR_THUMBNAIL_MAX_BYTES,
      readDiscordAvatarThumbnail,
    } = await import('../src/services/discord-avatar-media');
    const privateEmbed = await buildDiscordBotEmbed({ description: 'private', tenantId: 'tenant-media', mediaSlot: 'private' });
    const publicEmbed = await buildDiscordBotEmbed({ description: 'public', tenantId: 'tenant-media', mediaSlot: 'public' });
    const optimizedAvatar = await readDiscordAvatarThumbnail('tenant-media');

    assert.match(privateEmbed.thumbnail.url, /\/api\/discord-avatar\/idle\.gif\?tenant=tenant-media&v=/);
    assert.equal(privateEmbed.image?.url, 'https://media.test/private.gif');
    assert.match(publicEmbed.thumbnail.url, /\/api\/discord-avatar\/idle\.gif\?tenant=tenant-media&v=/);
    assert.equal(publicEmbed.image?.url, 'https://media.test/public.gif');
    assert.ok(optimizedAvatar);
    assert.ok(optimizedAvatar.length < DISCORD_AVATAR_THUMBNAIL_MAX_BYTES);
    const sharp = (await import('sharp')).default;
    const metadata = await sharp(optimizedAvatar, { animated: true }).metadata();
    assert.equal(metadata.format, 'gif');
    assert.ok((metadata.pages || 1) > 1);
    assert.ok((metadata.width || 0) <= 128);
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

test('EdenAI image payload excludes SeaArt-only tuning variables', async () => {
  const { buildEdenAIImagePayload, DEFAULT_EDEN_IMAGE_MODEL } = await import('../src/services/image-provider');
  const payload = buildEdenAIImagePayload({
    prompt: 'turtle doing disco at a party',
    resolution: '1024x1024',
    numImages: 1,
    providerParams: {
      cfg: 7,
      steps: 30,
      seed: 42,
      lora: 'anime-detailer',
      loraStrength: 0.8,
    },
  }, DEFAULT_EDEN_IMAGE_MODEL);

  assert.deepEqual(payload, {
    model: DEFAULT_EDEN_IMAGE_MODEL,
    input: {
      text: 'turtle doing disco at a party',
      resolution: '1024x1024',
      num_images: 1,
    },
  });
  assert.equal('provider_params' in payload, false);
});

test('EdenAI replaces retired or inaccessible saved model names with the supported default', async () => {
  const { buildEdenAIImagePayload, DEFAULT_EDEN_IMAGE_MODEL } = await import('../src/services/image-provider');
  const phoenixPayload = buildEdenAIImagePayload({
    prompt: 'astronaut doing the macarena',
  }, 'image/generation/leonardo/Leonardo Phoenix');
  const seedreamPayload = buildEdenAIImagePayload({
    prompt: 'astronaut doing the macarena',
    model: 'image/generation/bytedance/seedream-3-0-t2i-250415',
  }, DEFAULT_EDEN_IMAGE_MODEL);

  assert.equal(phoenixPayload.model, DEFAULT_EDEN_IMAGE_MODEL);
  assert.equal(seedreamPayload.model, DEFAULT_EDEN_IMAGE_MODEL);
  assert.equal(phoenixPayload.input.text, 'astronaut doing the macarena');
});

test('EdenAI retries a provider-access 404 with the next supported model', async () => {
  const originalFetch = global.fetch;
  const originalKey = process.env.EDENAI_API_KEY;
  const attemptedModels: string[] = [];
  process.env.EDENAI_API_KEY = 'test-key';

  try {
    global.fetch = (async (_input, init) => {
      const payload = JSON.parse(String(init?.body || '{}'));
      attemptedModels.push(payload.model);
      if (attemptedModels.length === 1) {
        return new Response(JSON.stringify({
          status: 'fail',
          output: null,
          error: {
            message: 'The model or endpoint custom-model does not exist or you do not have access to it.',
            provider_status_code: 404,
          },
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response(JSON.stringify({
        output: { items: [{ image_resource_url: 'https://images.test/fallback.png' }] },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;

    const { generateImageWithEdenAI, DEFAULT_EDEN_IMAGE_MODEL } = await import('../src/services/image-provider');
    const result = await generateImageWithEdenAI({
      prompt: 'astronaut doing the macarena',
      model: 'image/generation/example/custom-model',
    });

    assert.deepEqual(attemptedModels, ['image/generation/example/custom-model', DEFAULT_EDEN_IMAGE_MODEL]);
    assert.equal(result.imageResourceUrl, 'https://images.test/fallback.png');
  } finally {
    global.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.EDENAI_API_KEY;
    else process.env.EDENAI_API_KEY = originalKey;
  }
});

test('optimized image prompts remain grounded in the exact requested subject and action', async () => {
  const { groundOptimizedImagePrompt } = await import('../src/services/image-command');
  const prompt = groundOptimizedImagePrompt(
    'astronaut doing the macarena',
    'cinematic lighting, dramatic wide-angle composition',
  );

  assert.match(prompt, /PRIMARY REQUEST \(must be clearly visible\): astronaut doing the macarena/i);
  assert.match(prompt, /every subject and action/i);
  assert.match(prompt, /Do not replace .* with scenery/i);
});

test('public image overlay events support cached and current pack overlays', async () => {
  const { buildPublicImageOverlayMessages } = await import('../src/services/image-command');
  const messages = buildPublicImageOverlayMessages({
    prompt: 'optimized turtle',
    originalPrompt: 'turtle at the disco',
    optimizedPrompt: 'optimized turtle',
    provider: 'eden',
    images: ['https://streamweaver.test/generated/turtle.jpg'],
  }, 'viewer_name');

  assert.deepEqual(messages.map((message) => message.type), [
    'pokemon-show-card',
    'public-image-generated',
  ]);
  assert.ok(messages.every((message) => message.payload.imageUrl === 'https://streamweaver.test/generated/turtle.jpg'));
  assert.equal(messages[1].payload.prompt, 'turtle at the disco');
});
