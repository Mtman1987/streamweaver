import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('structured Discord replies post the embed before deleting the triggering message', async () => {
  const originalCwd = process.cwd();
  const originalFetch = global.fetch;
  const originalToken = process.env.DISCORD_BOT_TOKEN;
  const originalCleanup = process.env.DISCORD_BOT_MESSAGE_CLEANUP_ENABLED;
  const originalPublicUrl = process.env.STREAMWEAVER_PUBLIC_URL;
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'streamweaver-structured-discord-'));
  const calls: string[] = [];

  try {
    process.chdir(tempRoot);
    process.env.DISCORD_BOT_TOKEN = 'test-token';
    process.env.DISCORD_BOT_MESSAGE_CLEANUP_ENABLED = 'false';
    process.env.STREAMWEAVER_PUBLIC_URL = 'https://streamweaver.test';
    await mkdir(path.join(tempRoot, 'tokens'), { recursive: true });
    await writeFile(path.join(tempRoot, 'tokens', 'discord-webhooks.json'), JSON.stringify({
      'channel-1': {
        url: 'https://discord.test/webhook',
        username: 'Moonbeam',
        avatarUrl: 'https://discord.test/moonbeam.png',
      },
    }));

    global.fetch = (async (input, init) => {
      const url = String(input);
      if (url === 'https://discord.com/api/v10/users/@me') {
        return new Response(JSON.stringify({ id: 'bot-1', avatar: 'bot-avatar' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.startsWith('https://discord.test/webhook')) {
        calls.push('reply');
        const body = JSON.parse(String(init?.body || '{}'));
        assert.equal(body.content, '');
        assert.match(body.avatar_url, /\/assets\/space-logo-main\.png$/);
        assert.equal(body.embeds[0].author.name, 'Bot owned by SpaceMountain.live');
        assert.equal(body.embeds[0].title, 'Moonbeam • AI Answer');
        assert.match(body.embeds[0].footer.text, /^Requested by TestUser • Why is the bot offline\? • deletes in 10m$/);
        return new Response(JSON.stringify({ id: 'reply-1' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url === 'https://discord.com/api/v10/channels/channel-1/messages/source-1') {
        calls.push('delete');
        return new Response(null, { status: 204 });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) as typeof fetch;

    const { sendStructuredDiscordReply } = await import('../src/services/discord-structured-replies');
    const result = await sendStructuredDiscordReply({
      channelId: 'channel-1',
      message: 'The bot is online now.',
      tenantId: 'tenant-1',
      botName: 'Moonbeam',
      responseType: 'AI Answer',
      sourceMessageId: 'source-1',
      sourceMessage: 'Why is the bot offline?',
      sourceUser: 'TestUser',
      sourceUserAvatarUrl: 'https://discord.test/user.png',
    });

    assert.equal(result.messageId, 'reply-1');
    assert.deepEqual(calls, ['reply', 'delete']);
  } finally {
    global.fetch = originalFetch;
    process.chdir(originalCwd);
    if (originalToken === undefined) delete process.env.DISCORD_BOT_TOKEN;
    else process.env.DISCORD_BOT_TOKEN = originalToken;
    if (originalCleanup === undefined) delete process.env.DISCORD_BOT_MESSAGE_CLEANUP_ENABLED;
    else process.env.DISCORD_BOT_MESSAGE_CLEANUP_ENABLED = originalCleanup;
    if (originalPublicUrl === undefined) delete process.env.STREAMWEAVER_PUBLIC_URL;
    else process.env.STREAMWEAVER_PUBLIC_URL = originalPublicUrl;
    await rm(tempRoot, { recursive: true, force: true });
  }
});


test('private structured replies use the bot-token embed route and never a webhook', async () => {
  const originalFetch = global.fetch;
  const originalToken = process.env.DISCORD_BOT_TOKEN;
  const calls: string[] = [];

  try {
    process.env.DISCORD_BOT_TOKEN = 'test-token';
    global.fetch = (async (input, init) => {
      const url = String(input);
      if (url === 'https://discord.com/api/v10/users/@me') {
        return new Response(JSON.stringify({ id: 'bot-1', avatar: 'bot-avatar' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url === 'https://discord.com/api/v10/channels/dm-channel/messages') {
        calls.push('bot-token');
        const body = JSON.parse(String(init?.body || '{}'));
        assert.equal(init?.headers && (init.headers as Record<string, string>).Authorization, 'Bot test-token');
        assert.equal(body.content, '');
        assert.equal(body.embeds[0].description, 'Private Athena reply.');
        return new Response(JSON.stringify({ id: 'dm-reply-1' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.includes('webhook')) {
        calls.push('webhook');
        throw new Error('DM must not use a webhook');
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) as typeof fetch;

    const { sendStructuredDiscordReply } = await import('../src/services/discord-structured-replies');
    const result = await sendStructuredDiscordReply({
      channelId: 'dm-channel',
      message: 'Private Athena reply.',
      tenantId: 'tenant-1',
      botName: 'Athena',
      responseType: 'AI Answer',
      isPrivate: true,
    });

    assert.equal(result.messageId, 'dm-reply-1');
    assert.deepEqual(calls, ['bot-token']);
  } finally {
    global.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.DISCORD_BOT_TOKEN;
    else process.env.DISCORD_BOT_TOKEN = originalToken;
  }
});
