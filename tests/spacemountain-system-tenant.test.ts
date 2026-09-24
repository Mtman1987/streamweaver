import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

function read(file: string) {
  return fs.readFileSync(path.join(process.cwd(), file), 'utf8');
}

test('SpaceMountainLive remains a permanent system tenant with Stella persona', () => {
  const tenant = read('src/lib/tenant.ts');
  assert.match(tenant, /SPACEMOUNTAIN_SYSTEM_TENANT_ID = 'spacemountainlive'/);
  assert.match(tenant, /SPACEMOUNTAIN_SYSTEM_BOT_NAME = 'Stella'/);
  assert.match(tenant, /await bootstrapTenant\(SPACEMOUNTAIN_SYSTEM_TENANT_ID, SPACEMOUNTAIN_SYSTEM_TWITCH_CHANNEL\)/);
});

test('SpaceMountainLive uses StellaBot87 without community-bot fallback', () => {
  const twitch = read('src/services/twitch-client.ts');
  assert.match(twitch, /tenantId === SPACEMOUNTAIN_SYSTEM_TENANT_ID/);
  assert.match(twitch, /System tenant listening in #\$\{channel\} through Stella/);
  assert.match(twitch, /refusing community-bot fallback/);
});

test('SpaceMountain system tenant keeps Stella as its persona name', () => {
  const settings = read('src/lib/bot-settings-store.ts');
  assert.match(settings, /tenantId === SPACEMOUNTAIN_SYSTEM_TENANT_ID/);
  assert.match(settings, /return \{ \.\.\.settings \}/);
});

test('Stella Twitch AI responses post chat text and queue the same reply for TTS', () => {
  const dispatcher = read('src/services/chat-dispatcher.ts');
  assert.match(dispatcher, /sendChatMessage\(aiReply, 'bot', responseChannel, responseTenantId\)/);
  assert.match(dispatcher, /queueTtsOverlay\(aiReply, targetTenant\)/);
});
