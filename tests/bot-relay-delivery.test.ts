import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { runWithChatOutputContext } from '../src/services/chat-output-context';
import { sendTwitchChatMessage } from '../src/services/twitch';

test('relay Twitch sends bypass a Discord output context', async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; body: any }> = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), body: JSON.parse(String(init?.body || '{}')) });
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;

  try {
    await runWithChatOutputContext({ platform: 'discord', channelId: 'source-channel' }, () =>
      sendTwitchChatMessage('relay payload', 'bot', 'mamafeisty', 'mama-tenant'));
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /api\/twitch\/send-message/);
  assert.deepEqual(calls[0].body, {
    message: 'relay payload',
    as: 'bot',
    bridgeToDiscord: true,
    targetChannel: 'mamafeisty',
    tenantId: 'mama-tenant',
  });
});

test('relay live lookup checks Twitch directly and accepts either positive live source', () => {
  const root = process.cwd();
  const twitch = fs.readFileSync(path.join(root, 'src/services/twitch.ts'), 'utf8');
  const dispatcher = fs.readFileSync(path.join(root, 'src/services/chat-dispatcher.ts'), 'utf8');

  assert.match(twitch, /helix\/streams\?user_login=\$\{encodeURIComponent\(login\)\}/);
  assert.match(dispatcher, /directTwitchLive === true \|\| liveLookup\?\.isLive === true/);
});

test('relay source messages report the confirmed destination instead of promising early', () => {
  const root = process.cwd();
  const dispatcher = fs.readFileSync(path.join(root, 'src/services/chat-dispatcher.ts'), 'utf8');
  const discordRoute = fs.readFileSync(path.join(root, 'src/app/api/discord/chat/route.ts'), 'utf8');

  assert.doesNotMatch(dispatcher, /I'll pass that along/);
  assert.doesNotMatch(discordRoute, /I'll pass that along/);
  assert.match(dispatcher, /relayResult\.summary/);
  assert.match(discordRoute, /editStructuredDiscordReply\(sourceDiscordRelayMessageId/);
  assert.match(dispatcher, /sendTwitchChatMessage\(twitchRelayText/);
});
