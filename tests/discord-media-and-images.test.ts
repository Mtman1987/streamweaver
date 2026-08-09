import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { serializeSessionCookie } from '../src/lib/session-cookie';
import {
  DISCORD_MEDIA_MAX_FILE_MB,
  DISCORD_MEDIA_MAX_REQUEST_BYTES,
} from '../src/lib/discord-media-limits';

test('Discord embeds use responder branding, requester footer, and explicit media only', async () => {
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
    const privateEmbed = await buildDiscordBotEmbed({
      description: 'private answer',
      tenantId: 'tenant-media',
      botName: 'MediaBot',
      sourceMessage: 'Why is the bot offline?',
      sourceUser: 'TestUser',
      sourceUserAvatarUrl: 'https://cdn.test/user.png',
      deleteAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    });
    const imageEmbed = await buildDiscordBotEmbed({
      description: 'image prompt',
      tenantId: 'tenant-media',
      botName: 'MediaBot',
      responseType: 'Image Generated',
      sourceMessage: '!img a moonlit station',
      sourceUser: 'TestUser',
      imageUrl: 'https://media.test/generated.png',
    });
    const generatedFrameWithoutBonusGif = await buildDiscordBotEmbed({
      description: 'processing image',
      tenantId: 'tenant-media',
      botName: 'MediaBot',
      mediaSlot: 'private',
      includeConfiguredMedia: false,
    });
    const optimizedAvatar = await readDiscordAvatarThumbnail('tenant-media');

    assert.match(privateEmbed.thumbnail.url, /\/api\/discord-avatar\/idle\.gif\?tenant=tenant-media&v=/);
    assert.equal(privateEmbed.image, undefined);
    assert.equal(privateEmbed.author.name, 'MediaBot');
    assert.match(privateEmbed.author.icon_url || '', /\/api\/discord-avatar\/idle\.gif\?tenant=tenant-media&v=/);
    assert.equal(privateEmbed.title, 'MediaBot • AI Answer');
    assert.deepEqual(privateEmbed.fields, [{
      name: 'Question',
      value: 'Why is the bot offline?',
      inline: false,
    }]);
    assert.match(privateEmbed.footer.text, /^Requested by TestUser • Why is the bot offline\? • deletes in 10m$/);
    assert.equal(privateEmbed.footer.icon_url, 'https://cdn.test/user.png');
    assert.ok(Number.isFinite(Date.parse(privateEmbed.timestamp)));
    assert.equal(imageEmbed.title, 'MediaBot • Image Generated');
    assert.equal(imageEmbed.image?.url, 'https://media.test/generated.png');
    assert.equal(imageEmbed.fields, undefined);
    assert.equal(generatedFrameWithoutBonusGif.image, undefined);
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

test('Discord media upload rejects oversized and malformed multipart requests without throwing', async () => {
  process.env.STREAMWEAVER_SESSION_SECRET = 'discord-media-test-secret';
  const cookie = serializeSessionCookie({ id: 'tenant-media-upload', username: 'owner' });
  const { POST } = await import('../src/app/api/discord-media/route');

  const oversized = await POST(new NextRequest('http://localhost/api/discord-media', {
    method: 'POST',
    headers: {
      cookie: `streamweaver-session=${cookie}`,
      'content-type': 'multipart/form-data; boundary=oversized',
      'content-length': String(DISCORD_MEDIA_MAX_REQUEST_BYTES + 1),
    },
    body: '--oversized--',
  }));
  assert.equal(oversized.status, 413);
  assert.match(JSON.stringify(await oversized.json()), new RegExp(`${DISCORD_MEDIA_MAX_FILE_MB} MB`));

  const malformed = await POST(new NextRequest('http://localhost/api/discord-media', {
    method: 'POST',
    headers: {
      cookie: `streamweaver-session=${cookie}`,
      'content-type': 'multipart/form-data; boundary=missing',
    },
    body: 'not multipart data',
  }));
  assert.equal(malformed.status, 400);
  assert.match(JSON.stringify(await malformed.json()), /multipart/i);
});

test('avatar MP4 conversion maps avatar and Discord bonus slots to DiscordStreamHub', async () => {
  const { avatarGifConversionSlot } = await import('../src/app/api/avatars/route');
  assert.equal(avatarGifConversionSlot('idle'), 'avatar-idle');
  assert.equal(avatarGifConversionSlot('talking'), 'avatar-talking');
  assert.equal(avatarGifConversionSlot('private-dm'), 'private-dm');
  assert.equal(avatarGifConversionSlot('public-discord'), 'public-discord');
  assert.equal(avatarGifConversionSlot('gesture'), null);
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
      publicContentModeration: false,
      imageCount: 4,
    }));

    global.fetch = (async () => new Response(JSON.stringify({
      images: [1, 2, 3, 4].map((index) => `https://streamweaver.test/api/ai/image/file/${index}.png?tenantId=tenant-images`),
      provider: 'pollinations',
    }), { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch;

    const { runImageCommand } = await import('../src/services/image-command');
    const result = await runImageCommand('!img --count 4 a moonlit station', 'tenant-images', { scope: 'private' });
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

test('SeaArt recognizes stale model-version failures that should use the safe preset', async () => {
  const { isSeaArtModelMismatchError } = await import('../src/services/image-provider');
  assert.equal(isSeaArtModelMismatchError(new Error('SeaArt CLI failed: Error: model version mismatch')), true);
  assert.equal(isSeaArtModelMismatchError(new Error('SeaArt CLI failed: account unauthorized')), false);
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

test('public image access supports everyone, moderator-only, and off modes', async () => {
  const { canUsePublicImageGeneration } = await import('../src/services/image-command');
  const { getDefaultGenerationSettings } = await import('../src/lib/gen-settings-store');
  const defaults = getDefaultGenerationSettings();
  assert.equal(defaults.publicImageAccess, 'everyone');
  assert.equal(defaults.publicContentModeration, true);
  assert.equal(defaults.privateContentModeration, false);
  assert.equal(canUsePublicImageGeneration('everyone', false), true);
  assert.equal(canUsePublicImageGeneration('mods', false), false);
  assert.equal(canUsePublicImageGeneration('mods', true), true);
  assert.equal(canUsePublicImageGeneration('off', true), false);
});

test('Eden moderation reports flagged image prompts and their categories', async () => {
  const originalFetch = global.fetch;
  const originalKey = process.env.EDENAI_API_KEY;
  process.env.EDENAI_API_KEY = 'test-key';
  try {
    global.fetch = (async () => new Response(JSON.stringify({
      results: [{
        flagged: true,
        categories: { sexual: true, violence: false },
      }],
    }), { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch;

    const { moderateImagePrompt } = await import('../src/services/image-content-moderation');
    const result = await moderateImagePrompt('unsafe test prompt', 'tenant-moderation');
    assert.deepEqual(result, { flagged: true, categories: ['sexual'] });
  } finally {
    global.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.EDENAI_API_KEY;
    else process.env.EDENAI_API_KEY = originalKey;
  }
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
