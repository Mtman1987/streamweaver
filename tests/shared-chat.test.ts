import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { sendWithSharedChatAwareness } from '../src/services/shared-chat';

test('shared chat sends use Helix source-only even when no user token is available', async () => {
  const originalFetch = global.fetch;
  const originalClientId = process.env.TWITCH_CLIENT_ID;
  const originalClientSecret = process.env.TWITCH_CLIENT_SECRET;
  const originalBotUsername = process.env.TWITCH_BOT_USERNAME;

  process.env.TWITCH_CLIENT_ID = 'test-client-id';
  process.env.TWITCH_CLIENT_SECRET = 'test-client-secret';
  process.env.TWITCH_BOT_USERNAME = 'streamweaver87';

  const requests: Array<{ url: string; init?: RequestInit }> = [];

  global.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    requests.push({ url, init });

    if (url === 'https://id.twitch.tv/oauth2/token') {
      return new Response(JSON.stringify({ access_token: 'app-token', expires_in: 3600 }), { status: 200 });
    }

    if (url.includes('/helix/users?login=testchannel')) {
      return new Response(JSON.stringify({ data: [{ id: 'broadcaster-1' }] }), { status: 200 });
    }

    if (url.includes('/helix/shared_chat/session?broadcaster_id=broadcaster-1')) {
      return new Response(JSON.stringify({ data: [{ session_id: 'shared-session-1', participants: [{ broadcaster_id: 'broadcaster-1' }, { broadcaster_id: 'partner-1' }] }] }), { status: 200 });
    }

    if (url.includes('/helix/users?login=streamweaver87')) {
      return new Response(JSON.stringify({ data: [{ id: 'sender-1' }] }), { status: 200 });
    }

    if (url === 'https://api.twitch.tv/helix/chat/messages') {
      return new Response(JSON.stringify({ data: [{ is_sent: true }] }), { status: 200 });
    }

    throw new Error(`Unexpected fetch call: ${url}`);
  }) as typeof fetch;

  const client = {
    getUsername: () => 'streamweaver87',
    getChannels: () => ['#testchannel'],
    readyState: () => 'OPEN',
    say: async () => {
      throw new Error('IRC fallback should not be used when Helix source-only succeeds');
    },
  };

  try {
    await sendWithSharedChatAwareness({
      client,
      channel: 'testchannel',
      message: 'hello shared chat',
      as: 'bot',
    });

    const helixSend = requests.find((entry) => entry.url === 'https://api.twitch.tv/helix/chat/messages');
    assert.ok(helixSend, 'expected a Helix chat send');
    assert.equal(helixSend?.init?.headers && (helixSend.init.headers as Record<string, string>).Authorization, 'Bearer app-token');

    const body = JSON.parse(String(helixSend?.init?.body || '{}'));
    assert.equal(body.for_source_only, true);
    assert.equal(body.message, 'hello shared chat');
    assert.equal(body.broadcaster_id, 'broadcaster-1');
    assert.equal(body.sender_id, 'sender-1');
  } finally {
    global.fetch = originalFetch;
    if (originalClientId === undefined) delete process.env.TWITCH_CLIENT_ID;
    else process.env.TWITCH_CLIENT_ID = originalClientId;
    if (originalClientSecret === undefined) delete process.env.TWITCH_CLIENT_SECRET;
    else process.env.TWITCH_CLIENT_SECRET = originalClientSecret;
    if (originalBotUsername === undefined) delete process.env.TWITCH_BOT_USERNAME;
    else process.env.TWITCH_BOT_USERNAME = originalBotUsername;
  }
});

test('shared chat source-only retries with a stored user token when app authorization is insufficient', async () => {
  const originalFetch = global.fetch;
  const originalClientId = process.env.TWITCH_CLIENT_ID;
  const originalClientSecret = process.env.TWITCH_CLIENT_SECRET;
  const originalBotUsername = process.env.TWITCH_BOT_USERNAME;
  const tenantId = 'shared-chat-test-tenant';
  const tenantTokensPath = path.join(process.cwd(), 'data', 'runtime', 'tenants', tenantId, 'tokens', 'twitch-tokens.json');
  const communityTokensPath = path.join(process.cwd(), 'data', 'runtime', 'global', 'community-bot-tokens.json');
  const tenantTokensBackup = await fs.readFile(tenantTokensPath, 'utf8').catch(() => null);
  const communityTokensBackup = await fs.readFile(communityTokensPath, 'utf8').catch(() => null);

  process.env.TWITCH_CLIENT_ID = 'test-client-id';
  process.env.TWITCH_CLIENT_SECRET = 'test-client-secret';
  process.env.TWITCH_BOT_USERNAME = 'communitybot';

  await fs.mkdir(path.dirname(tenantTokensPath), { recursive: true });
  await fs.writeFile(tenantTokensPath, JSON.stringify({
    broadcasterToken: 'broadcaster-token',
    broadcasterRefreshToken: 'broadcaster-refresh',
    broadcasterTokenExpiry: Date.now() + 10 * 60_000,
  }));
  await fs.mkdir(path.dirname(communityTokensPath), { recursive: true });
  await fs.writeFile(communityTokensPath, JSON.stringify({
    communityBotToken: 'community-token',
    communityBotRefreshToken: 'community-refresh',
    communityBotTokenExpiry: Date.now() + 10 * 60_000,
    communityBotUsername: 'communitybot',
  }));

  const authHeaders: string[] = [];
  let ircFallbackSent = false;
  global.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);

    if (url === 'https://id.twitch.tv/oauth2/token') {
      return new Response(JSON.stringify({ access_token: 'app-token', expires_in: 3600 }), { status: 200 });
    }

    if (url === 'https://id.twitch.tv/oauth2/validate') {
      const auth = String((init?.headers as Record<string, string> | undefined)?.Authorization || '');
      if (auth === 'Bearer community-token' || auth === 'Bearer broadcaster-token') {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      return new Response('{}', { status: 401 });
    }

    if (url.includes('/helix/users?login=testchannel')) {
      return new Response(JSON.stringify({ data: [{ id: 'broadcaster-1' }] }), { status: 200 });
    }

    if (url.includes('/helix/shared_chat/session?broadcaster_id=broadcaster-1')) {
      return new Response(JSON.stringify({ data: [{ session_id: 'shared-session-1', participants: [{ broadcaster_id: 'broadcaster-1' }, { broadcaster_id: 'partner-1' }] }] }), { status: 200 });
    }

    if (url.includes('/helix/users?login=communitybot')) {
      return new Response(JSON.stringify({ data: [{ id: 'sender-1' }] }), { status: 200 });
    }

    if (url === 'https://api.twitch.tv/helix/chat/messages') {
      const auth = String((init?.headers as Record<string, string> | undefined)?.Authorization || '');
      authHeaders.push(auth);
      if (auth === 'Bearer app-token') {
        return new Response('The sender must have authorized the app with the user:bot scope.', { status: 401 });
      }
      if (auth === 'Bearer community-token') {
        return new Response(JSON.stringify({ data: [{ is_sent: true }] }), { status: 200 });
      }
    }

    throw new Error(`Unexpected fetch call: ${url}`);
  }) as typeof fetch;

  const client = {
    getUsername: () => 'communitybot',
    getChannels: () => ['#testchannel'],
    readyState: () => 'OPEN',
    say: async () => {
      ircFallbackSent = true;
    },
  };

  try {
    await sendWithSharedChatAwareness({
      client,
      channel: 'testchannel',
      message: 'hello from community bot',
      as: 'bot',
      tenantId,
    });

    assert.deepEqual(authHeaders, ['Bearer app-token', 'Bearer community-token']);
    assert.equal(ircFallbackSent, false);
  } finally {
    global.fetch = originalFetch;
    if (tenantTokensBackup === null) {
      await fs.rm(tenantTokensPath, { force: true });
    } else {
      await fs.writeFile(tenantTokensPath, tenantTokensBackup);
    }
    if (communityTokensBackup === null) {
      await fs.rm(communityTokensPath, { force: true });
    } else {
      await fs.writeFile(communityTokensPath, communityTokensBackup);
    }
    if (originalClientId === undefined) delete process.env.TWITCH_CLIENT_ID;
    else process.env.TWITCH_CLIENT_ID = originalClientId;
    if (originalClientSecret === undefined) delete process.env.TWITCH_CLIENT_SECRET;
    else process.env.TWITCH_CLIENT_SECRET = originalClientSecret;
    if (originalBotUsername === undefined) delete process.env.TWITCH_BOT_USERNAME;
    else process.env.TWITCH_BOT_USERNAME = originalBotUsername;
  }
});

test('shared chat detection prefers tenant broadcaster token before app-token fallback', async () => {
  const originalFetch = global.fetch;
  const originalClientId = process.env.TWITCH_CLIENT_ID;
  const originalClientSecret = process.env.TWITCH_CLIENT_SECRET;
  const tenantId = 'shared-chat-lookup-tenant';
  const channel = 'tenantlookupchannel';
  const tenantTokensPath = path.join(process.cwd(), 'data', 'runtime', 'tenants', tenantId, 'tokens', 'twitch-tokens.json');
  const tenantTokensBackup = await fs.readFile(tenantTokensPath, 'utf8').catch(() => null);

  process.env.TWITCH_CLIENT_ID = 'test-client-id';
  process.env.TWITCH_CLIENT_SECRET = 'test-client-secret';

  await fs.mkdir(path.dirname(tenantTokensPath), { recursive: true });
  await fs.writeFile(tenantTokensPath, JSON.stringify({
    broadcasterToken: 'broadcaster-token',
    broadcasterRefreshToken: 'broadcaster-refresh',
    broadcasterTokenExpiry: Date.now() + 10 * 60_000,
  }));

  const sharedSessionAuthHeaders: string[] = [];

  global.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    const auth = String((init?.headers as Record<string, string> | undefined)?.Authorization || '');

    if (url === 'https://id.twitch.tv/oauth2/validate') {
      if (auth === 'Bearer broadcaster-token') {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      return new Response('{}', { status: 401 });
    }

    if (url.includes(`/helix/users?login=${channel}`)) {
      return new Response(JSON.stringify({ data: [{ id: 'broadcaster-1' }] }), { status: 200 });
    }

    if (url.includes('/helix/shared_chat/session?broadcaster_id=broadcaster-1')) {
      sharedSessionAuthHeaders.push(auth);
      return new Response(JSON.stringify({ data: [{ session_id: 'shared-session-1', participants: [{ broadcaster_id: 'broadcaster-1' }, { broadcaster_id: 'partner-1' }] }] }), { status: 200 });
    }

    if (url.includes('/helix/users?login=tenantbot')) {
      return new Response(JSON.stringify({ data: [{ id: 'sender-1' }] }), { status: 200 });
    }

    if (url === 'https://id.twitch.tv/oauth2/token') {
      return new Response(JSON.stringify({ access_token: 'app-token', expires_in: 3600 }), { status: 200 });
    }

    if (url === 'https://api.twitch.tv/helix/chat/messages') {
      return new Response(JSON.stringify({ data: [{ is_sent: true }] }), { status: 200 });
    }

    throw new Error(`Unexpected fetch call: ${url}`);
  }) as typeof fetch;

  const client = {
    getUsername: () => 'tenantbot',
    getChannels: () => ['#testchannel'],
    readyState: () => 'OPEN',
    say: async () => {
      throw new Error('IRC fallback should not be used when Helix source-only succeeds');
    },
  };

  try {
    await sendWithSharedChatAwareness({
      client,
      channel,
      message: 'hello shared chat',
      as: 'bot',
      tenantId,
    });

    assert.deepEqual(sharedSessionAuthHeaders, ['Bearer broadcaster-token']);
  } finally {
    global.fetch = originalFetch;
    if (tenantTokensBackup === null) {
      await fs.rm(tenantTokensPath, { force: true });
    } else {
      await fs.writeFile(tenantTokensPath, tenantTokensBackup);
    }
    if (originalClientId === undefined) delete process.env.TWITCH_CLIENT_ID;
    else process.env.TWITCH_CLIENT_ID = originalClientId;
    if (originalClientSecret === undefined) delete process.env.TWITCH_CLIENT_SECRET;
    else process.env.TWITCH_CLIENT_SECRET = originalClientSecret;
  }
});
