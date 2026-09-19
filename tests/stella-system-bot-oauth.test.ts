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

test('SML runtime prefers Stella and falls back to StreamWeaver87', () => {
  const runtime = read('src/services/twitch-client.ts');

  assert.match(runtime, /Stella connected as/);
  assert.match(runtime, /System tenant listening in #\$\{channel\} through Stella/);
  assert.match(runtime, /Stella bot unavailable; falling back to StreamWeaver87/);
  assert.match(runtime, /!isSharedCommunityBotClient\(tenant\.botClient\)/);
});

test('Stella replies post to Twitch only when her dedicated bot exists', () => {
  const dispatcher = read('src/services/chat-dispatcher.ts');

  assert.match(dispatcher, /tenantHasBotAccount\(SPACEMOUNTAIN_SYSTEM_TENANT_ID\)/);
  assert.match(dispatcher, /sendChatMessage\([\s\S]*aiReply,[\s\S]*'bot',[\s\S]*SPACEMOUNTAIN_SYSTEM_TENANT_ID/);
  assert.match(dispatcher, /Twitch \+ Lounge TTS/);
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
