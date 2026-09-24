import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');

test('Stella OAuth is owner-only and pinned to StellaBot87', () => {
  const start = read('src/app/api/auth/twitch/route.ts');
  const callback = read('src/app/auth/twitch/callback/route.ts');
  const txn = read('src/lib/twitch-privileged-oauth.server.ts');

  assert.match(start, /'space-mountain-bot'/);
  assert.match(start, /role === 'space-mountain-bot'/);
  assert.match(txn, /'space-mountain-bot'/);
  assert.match(callback, /username !== 'stellabot87'/);
  assert.match(callback, /wrong_stella_account/);
});

test('Stella OAuth writes only bot credentials to the SpaceMountain system tenant', () => {
  const callback = read('src/app/auth/twitch/callback/route.ts');
  const start = callback.indexOf('if (isSpaceMountainBot)');
  const end = callback.indexOf('// Community bot is admin-only', start);
  const flow = callback.slice(start, end);

  assert.match(flow, /SPACEMOUNTAIN_SYSTEM_TENANT_ID/);
  assert.match(flow, /botToken:/);
  assert.match(flow, /botRefreshToken:/);
  assert.match(flow, /botUsername:/);
  assert.doesNotMatch(flow, /broadcasterToken:/);
  assert.match(flow, /reconnectTwitchTenant\(SPACEMOUNTAIN_SYSTEM_TENANT_ID\)/);
});

test('SML runtime uses Stella only and refuses community-bot fallback', () => {
  const runtime = read('src/services/twitch-client.ts');

  assert.match(runtime, /Stella connected as/);
  assert.match(runtime, /System tenant listening in #\$\{channel\} through Stella/);
  assert.match(runtime, /Stella bot unavailable; system tenant remains disconnected/);
  assert.match(runtime, /refusing community-bot fallback/);
});

test('SpaceMountain broadcaster sends delegate to ChatTag while bot sends stay Stella', () => {
  const runtime = read('src/services/twitch-client.ts');
  const routes = read('src/server/routes.ts');

  assert.match(runtime, /resolveOutboundTwitchRoute/);
  assert.match(runtime, /requestedTenantId === SPACEMOUNTAIN_SYSTEM_TENANT_ID/);
  assert.match(runtime, /requestedChannel === SPACEMOUNTAIN_SYSTEM_TWITCH_CHANNEL/);
  assert.match(runtime, /clientType: requestedIdentity === 'broadcaster' \? 'broadcaster' : 'bot'/);
  assert.match(runtime, /sendAs: requestedIdentity/);
  assert.match(routes, /sendSpaceMountainBroadcasterMessage/);
  assert.match(routes, /chat-tag-bot-new\.fly\.dev/);
  assert.match(routes, /\/internal\/spacemountainlive-send/);
  assert.match(routes, /delegated: 'chat-tag'/);
});

test('Stella replies post to Twitch before the same text can reach Lounge TTS', () => {
  const dispatcher = read('src/services/chat-dispatcher.ts');
  const directStart = dispatcher.indexOf('Stella system-tenant reply skipped');
  const directEnd = dispatcher.indexOf('// The Count is a built-in character', directStart);
  const direct = dispatcher.slice(directStart, directEnd);

  assert.match(direct, /tenantHasBotAccount\(SPACEMOUNTAIN_SYSTEM_TENANT_ID\)/);
  assert.match(direct, /sendChatMessage\([\s\S]*aiReply,[\s\S]*'bot',[\s\S]*SPACEMOUNTAIN_SYSTEM_TENANT_ID/);
  assert.match(direct, /queueTtsOverlay\(aiReply, SPACEMOUNTAIN_SYSTEM_TENANT_ID\)/);
  assert.ok(direct.indexOf('sendChatMessage(') < direct.indexOf('queueTtsOverlay('));
  assert.match(dispatcher, /!isSpaceMountainSystemReply \|\| twitchBotPosted/);
});

test('owner Integrations UI exposes Stella connection status and OAuth button', () => {
  const ui = read('src/app/(app)/integrations/page.tsx');
  const status = read('src/app/api/integrations/twitch/status/route.ts');

  assert.match(ui, /Stella — SpaceMountainLive Bot/);
  assert.match(ui, /connectTwitch\("space-mountain-bot"\)/);
  assert.match(ui, /Authorize Stella/);
  assert.match(status, /spaceMountainBotConnected/);
  assert.match(status, /spaceMountainBotUsername/);
});
