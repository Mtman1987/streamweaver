import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import ts from 'typescript';
import { z } from 'zod';

import { buildSayChatSpeech, resolveSayChatIdentity } from '../src/services/say-chat';
import { resolveSayStreamKey } from '../src/services/say-tts';
import { createSayChatRequestCache } from '../src/services/say-chat-request';

test('speech-to-chat uses the signed display name and avatar', () => {
  const identity = resolveSayChatIdentity({
    tenantId: 'tenant-1',
    username: 'mtman1987',
    displayName: 'Mtman1987',
    avatar: 'https://cdn.example.com/mtman.png',
  });

  assert.deepEqual(identity, {
    username: 'Mtman1987',
    avatarUrl: 'https://cdn.example.com/mtman.png',
  });
  assert.equal(buildSayChatSpeech(identity, 'What about this?'), 'Mtman said: What about this?');
});

test('speech-to-chat falls back to the signed username', () => {
  const identity = resolveSayChatIdentity({
    tenantId: 'tenant-2',
    username: 'mothermayrien',
  });

  assert.deepEqual(identity, { username: 'mothermayrien', avatarUrl: undefined });
  assert.equal(buildSayChatSpeech(identity, 'hello there'), 'mothermayrien said: hello there');
});


test('SpaceMountain Twitch chat and Lounge browser source share one public TTS lane', () => {
  assert.equal(resolveSayStreamKey(undefined, 'twitch', 'spacemountainlive'), 'spacemountainlive');
  assert.equal(resolveSayStreamKey('spacemountainlive', 'twitch', 'spacemountainlive'), 'spacemountainlive');
  assert.equal(resolveSayStreamKey(undefined, 'twitch', 'otherchannel'), 'twitch:otherchannel');
});


test('speech-to-chat posts once and lets the Twitch echo become the only TTS source', () => {
  const route = readFileSync(new URL('../src/app/api/say/chat/route.ts', import.meta.url), 'utf8');
  const serverRoutes = readFileSync(new URL('../src/server/routes.ts', import.meta.url), 'utf8');
  const dispatcher = readFileSync(new URL('../src/services/chat-dispatcher.ts', import.meta.url), 'utf8');

  assert.match(route, /forceSayTts: true/);
  assert.doesNotMatch(route, /generateTTS\(/);
  assert.doesNotMatch(route, /addSayQueueItem\(/);
  assert.match(route, /delivered: 'chat-echo'/);
  assert.match(route, /tenantId: session\.tenantId, signedInSenderLogin: session\.username/);
  assert.match(serverRoutes, /forceNextSayEcho\(channel, suppressEchoSpeaker, message\)/);
  assert.match(serverRoutes, /cancelForcedSayEcho\(channel, suppressEchoSpeaker, message\)/);
  assert.match(dispatcher, /consumeForcedSayEcho\(replyChannel, actualUsername, actualMessage\)/);
  assert.match(dispatcher, /\(!isSpaceMountainDataSpeaker \|\| forcedSayEcho\)/);
  assert.match(dispatcher, /if \(!forcedSayEcho && !isSayEnabled/);
});

// Run the real HTTP route while replacing authentication and external sends.
// Inputs below are canonical stream keys returned by the queue resolver.
function sayChatRouteFixture(reply: { status?: number; body?: unknown; invalidJson?: boolean } = {}) {
  const twitchRequests: Array<{ url: string; body: any }> = [];
  const discordRequests: unknown[][] = [];
  const output = { exports: {} as any };
  const source = readFileSync(new URL('../src/app/api/say/chat/route.ts', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const imports: Record<string, unknown> = {
    'node:crypto': { createHash },
    '@/lib/internal-service-auth': { internalServiceHeaders: (headers: any) => ({ ...headers, Authorization: 'Bearer test-internal' }) },
    zod: { z },
    '@/services/say-chat-request': { runSayChatRequest: createSayChatRequestCache() },
    '@/lib/api-response': {
      apiOk: (data: unknown) => Response.json({ ok: true, data }),
      apiError: (error: string, options: { status: number; code: string }) =>
        Response.json({ ok: false, error, code: options.code }, { status: options.status }),
    },
    '@/lib/tenant-context': {
      getTenantFromRequest: () => ({ tenantId: '94371378', username: 'mtman1987' }),
    },
    '../_stream': { resolveSayQueueStreamKey: async (key: string) => key },
    '@/services/say-chat': { resolveSayChatIdentity },
    '@/services/discord-webhooks': {
      sendWebhookMessage: async (...args: unknown[]) => { discordRequests.push(args); },
    },
  };
  vm.runInNewContext(compiled, {
    exports: output.exports,
    require(name: string) {
      if (!(name in imports)) throw new Error(`Unexpected import ${name}`);
      return imports[name];
    },
    process: { env: { WS_PORT: '8090' } },
    console: { error() {} },
    fetch: async (url: string, options: any) => {
      twitchRequests.push({ url, body: JSON.parse(options.body) });
      const status = reply.status ?? 200;
      return {
        ok: status >= 200 && status < 300,
        json: async () => {
          if (reply.invalidJson) throw new Error('Invalid JSON');
          return reply.body ?? { success: true, delegated: 'chat-tag' };
        },
      };
    },
  });
  return {
    twitchRequests,
    discordRequests,
    post: (streamKey: string) => output.exports.POST({
      json: async () => ({ streamKey, text: 'Hello from the microphone' }),
    }) as Promise<Response>,
  };
}

test('Lounge microphone posts to SpaceMountainLive even when another account is signed in', async () => {
  const f = sayChatRouteFixture();
  const streamKey = resolveSayStreamKey(undefined, 'twitch', 'spacemountainlive');
  const response = await f.post(streamKey);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).data.posted, true);
  assert.equal(f.twitchRequests.length, 1);
  assert.deepEqual(f.twitchRequests[0], {
    url: 'http://127.0.0.1:8090/api/twitch/send-message',
    body: {
      message: 'Hello from the microphone', as: 'broadcaster',
      tenantId: '94371378', signedInSenderLogin: 'mtman1987',
      targetChannel: 'spacemountainlive', forceSayTts: true,
    },
  });
  assert.equal(f.discordRequests.length, 0);
});

test('tenant Twitch microphone keeps its selected channel', async () => {
  const f = sayChatRouteFixture({ body: { success: true } });
  const response = await f.post(resolveSayStreamKey(undefined, 'twitch', 'otherchannel'));
  assert.equal(response.status, 200);
  assert.equal(f.twitchRequests[0].body.targetChannel, 'otherchannel');
  assert.equal(f.twitchRequests[0].body.tenantId, '94371378');
  assert.equal(f.twitchRequests[0].body.signedInSenderLogin, 'mtman1987');
});

test('Discord microphone keeps its room and signed-in identity', async () => {
  const f = sayChatRouteFixture();
  const response = await f.post('discord:123456789012345678');
  assert.equal(response.status, 200);
  assert.equal(f.twitchRequests.length, 0);
  assert.deepEqual(f.discordRequests, [[
    '123456789012345678', 'Hello from the microphone', 'mtman1987', undefined,
  ]]);
});

for (const [name, reply, expectedError] of [
  ['skipped send', { body: { success: true, skipped: true, reason: 'community-bot-read-only' } }, /skipped/],
  ['rejected send', { body: { success: false, error: 'Delivery rejected' } }, /Delivery rejected/],
  ['missing receipt', { body: {} }, /Twitch chat post failed/],
  ['invalid receipt', { invalidJson: true }, /Twitch chat post failed/],
  ['unavailable service', { status: 503, body: { error: 'broadcaster client not available' } }, /broadcaster client not available/],
] as const) {
  test(`microphone does not report posted after ${name}`, async () => {
    const f = sayChatRouteFixture(reply);
    const response = await f.post('spacemountainlive');
    assert.equal(response.status, 502);
    const result = await response.json();
    assert.equal(result.ok, false);
    assert.equal(result.code, 'CHAT_POST_FAILED');
    assert.match(result.error, expectedError);
    assert.equal(result.data?.posted, undefined);
    assert.equal(f.twitchRequests.length, 1);
  });
}

