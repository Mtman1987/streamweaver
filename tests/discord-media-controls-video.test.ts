import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';
import {
  normalizeDiscordImageCommandAlias,
  parseDiscordChatPayload,
} from '../src/lib/discord-chat-payload';
import { parseImageCommand } from '../src/services/image-command';
import { isSupportedDiscordVideoFile } from '../src/services/dsh-clip-worker';

test('normalizes !mg into the canonical Discord !img command', () => {
  assert.equal(normalizeDiscordImageCommandAlias('!mg'), '!img');
  assert.equal(normalizeDiscordImageCommandAlias('  !MG a moon station'), '  !img a moon station');
  assert.equal(normalizeDiscordImageCommandAlias('please run !mg'), 'please run !mg');

  const direct = parseDiscordChatPayload(JSON.stringify({ content: '!mg a moon station' }));
  assert.equal(direct.content, '!img a moon station');
  const nested = parseDiscordChatPayload(JSON.stringify({ root: { message: '!mg' } }));
  assert.equal(nested.root.message, '!img');
});

test('image parsing accepts !mg with the same options as !img', () => {
  assert.deepEqual(parseImageCommand('!mg --raw 2 a moonlit station'), {
    prompt: 'a moonlit station',
    raw: true,
    count: 2,
    provider: undefined,
  });
  assert.deepEqual(parseImageCommand('!img --free -n 3 nebula train'), {
    prompt: 'nebula train',
    raw: false,
    count: 3,
    provider: 'pollinations',
  });
});

test('Discord media video detection accepts only supported video containers', () => {
  assert.equal(isSupportedDiscordVideoFile({ name: 'clip.mp4', type: 'video/mp4' }), true);
  assert.equal(isSupportedDiscordVideoFile({ name: 'clip.webm', type: 'video/webm' }), true);
  assert.equal(isSupportedDiscordVideoFile({ name: 'clip.mov', type: 'video/quicktime' }), true);
  assert.equal(isSupportedDiscordVideoFile({ name: 'clip.gif', type: 'image/gif' }), false);
  assert.equal(isSupportedDiscordVideoFile({ name: 'clip.exe', type: 'video/mp4' }), false);
  assert.equal(isSupportedDiscordVideoFile({ name: 'clip.mp4', type: 'text/plain' }), false);
});

test('rotating image library updates the page URL every 60-120 seconds', async () => {
  const persistRoot = await mkdtemp(path.join(os.tmpdir(), 'streamweaver-rotate-library-'));
  const originalRoot = process.env.PERSIST_ROOT;
  process.env.PERSIST_ROOT = persistRoot;

  try {
    const imageDir = path.join(persistRoot, 'tenants', 'tenant-rotate', 'data', 'private-generated-images');
    await mkdir(imageDir, { recursive: true });
    await writeFile(path.join(imageDir, 'first.png'), 'first');
    await writeFile(path.join(imageDir, 'second.gif'), 'second');

    const { GET } = await import('../src/app/api/ai/image/library/route');
    const response = await GET(new NextRequest(
      'http://localhost/api/ai/image/library?tenantId=tenant-rotate&scope=private&view=rotate&interval=75',
    ));
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.match(html, /const intervalMs = 75000/);
    assert.match(html, /history\.replaceState/);
    assert.match(html, /searchParams\.set\('image'/);
    assert.match(html, /searchParams\.set\('v'/);
    assert.match(html, /first\.png/);
    assert.match(html, /second\.gif/);
  } finally {
    if (originalRoot === undefined) delete process.env.PERSIST_ROOT;
    else process.env.PERSIST_ROOT = originalRoot;
    await rm(persistRoot, { recursive: true, force: true });
  }
});

test('empty !img help includes the rotating library and public configured media', async () => {
  const persistRoot = await mkdtemp(path.join(os.tmpdir(), 'streamweaver-image-help-'));
  const originalRoot = process.env.PERSIST_ROOT;
  const originalPublicUrl = process.env.STREAMWEAVER_PUBLIC_URL;
  process.env.PERSIST_ROOT = persistRoot;
  process.env.STREAMWEAVER_PUBLIC_URL = 'https://streamweaver.example';

  try {
    const tokensDir = path.join(persistRoot, 'tenants', 'tenant-help', 'tokens');
    await mkdir(tokensDir, { recursive: true });
    await writeFile(path.join(tokensDir, 'user-config.json'), JSON.stringify({
      AI_BOT_NAME: 'HelpBot',
      PUBLIC_DISCORD_GIF_URL: 'https://media.example/public.gif',
    }));

    const { buildStructuredDiscordReplyPayload } = await import('../src/services/discord-structured-replies');
    const payload = await buildStructuredDiscordReplyPayload({
      channelId: '1234567890123456789',
      message: 'Usage: !img <description>',
      tenantId: 'tenant-help',
      botName: 'HelpBot',
      responseType: 'Command Help',
      isPrivate: false,
    });
    const embed = payload.embeds[0] as any;

    assert.match(embed.description, /alias: !mg/i);
    assert.match(embed.description, /\/api\/ai\/image\/library\?/);
    assert.match(embed.description, /view=rotate/);
    assert.match(embed.description, /interval=90/);
    assert.match(embed.description, /updates its page URL/i);
    assert.equal(embed.image?.url, 'https://media.example/public.gif');
  } finally {
    if (originalRoot === undefined) delete process.env.PERSIST_ROOT;
    else process.env.PERSIST_ROOT = originalRoot;
    if (originalPublicUrl === undefined) delete process.env.STREAMWEAVER_PUBLIC_URL;
    else process.env.STREAMWEAVER_PUBLIC_URL = originalPublicUrl;
    await rm(persistRoot, { recursive: true, force: true });
  }
});
