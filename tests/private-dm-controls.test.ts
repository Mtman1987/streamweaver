import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  PRIVATE_DM_CONTROL_FIELD_NAME,
  attachPrivateDmControls,
  buildPrivateDmControlField,
  createPrivateDmControlToken,
  isPrivateDmControlField,
  parsePrivateDmControlAction,
  splitPrivateTtsText,
  togglePrivateDmGif,
  verifyPrivateDmControlToken,
} from '../src/services/private-dm-controls';

process.env.PRIVATE_DM_CONTROL_SECRET = 'test-private-control-secret-with-enough-entropy';
process.env.APP_URL = 'https://streamweaver.example';

const channelId = '1234567890123456789';
const messageId = '9876543210987654321';

test('signs private DM controls and rejects tampering or expiration', () => {
  const token = createPrivateDmControlToken({
    channelId,
    messageId,
    nowSeconds: 1_000,
    ttlSeconds: 600,
  });
  assert.deepEqual(verifyPrivateDmControlToken(token, 1_100), {
    channelId,
    messageId,
    expiresAt: 1_600,
  });
  assert.equal(verifyPrivateDmControlToken(`${token}x`, 1_100), null);
  assert.equal(verifyPrivateDmControlToken(token, 1_601), null);
});

test('creates five emoji-only markdown links without Discord buttons', () => {
  const field = buildPrivateDmControlField({
    channelId,
    messageId,
    nowSeconds: 1_000,
  });
  assert.equal(field.name, PRIVATE_DM_CONTROL_FIELD_NAME);
  assert.equal(field.inline, false);
  assert.ok(field.value.length <= 1024);
  assert.equal((field.value.match(/\]\(/g) || []).length, 5);
  assert.match(field.value, /\[🖼️\]/u);
  assert.match(field.value, /\[🔊\]/u);
  assert.match(field.value, /\[🔞\]/u);
  assert.match(field.value, /\[⚙️\]/u);
  assert.match(field.value, /\[🗑️\]/u);
  assert.equal(/button|components|toggle gif|settings/i.test(field.value), false);
});

test('attaches one titleless control field and replaces an older copy', () => {
  const first = attachPrivateDmControls([{
    description: 'Private answer',
    fields: [{ name: 'Question', value: 'Hello' }],
  }], { channelId, messageId, nowSeconds: 1_000 });
  const second = attachPrivateDmControls(first, { channelId, messageId, nowSeconds: 1_050 });
  const fields = (second[0] as any).fields;
  assert.equal(fields.length, 2);
  assert.equal(fields.filter(isPrivateDmControlField).length, 1);
  assert.equal(fields[0].name, 'Question');
});

test('toggles only the private GIF while preserving the answer and icon field', () => {
  const original = attachPrivateDmControls([{
    description: 'Private answer',
    image: { url: 'https://streamweaver.example/private.gif' },
  }], { channelId, messageId, nowSeconds: 1_000 });

  const hidden = togglePrivateDmGif(original, 'https://streamweaver.example/private.gif');
  assert.equal(hidden.visible, false);
  assert.equal((hidden.embeds[0] as any).image, undefined);
  assert.equal((hidden.embeds[0] as any).description, 'Private answer');
  assert.equal((hidden.embeds[0] as any).fields.filter(isPrivateDmControlField).length, 1);

  const shown = togglePrivateDmGif(hidden.embeds, 'https://streamweaver.example/private.gif');
  assert.equal(shown.visible, true);
  assert.equal((shown.embeds[0] as any).image.url, 'https://streamweaver.example/private.gif');
});

test('private GIF settings preserve app-specific embed artwork', () => {
  const appImage = 'https://chat-tag.example/card.png';
  const hidden = togglePrivateDmGif([{
    description: 'Chat Tag pack',
    image: { url: appImage },
  }], 'https://streamweaver.example/private.gif');
  assert.equal(hidden.visible, true);
  assert.equal((hidden.embeds[0] as any).image.url, appImage);
});

test('shared private DM finalizer is authenticated and applies saved controls', () => {
  const routeSource = readFileSync(
    new URL('../src/app/api/private-chat/finalize-discord-message/route.ts', import.meta.url),
    'utf8',
  );

  assert.match(routeSource, /hasInternalServiceAccess\(request\)/);
  assert.match(routeSource, /resolvePrivateDmTenantId\(channelId\)/);
  assert.match(routeSource, /readPrivateChatSettings\(tenantId\)/);
  assert.match(routeSource, /applyPrivateDmGif\(currentEmbeds, mediaUrl, settings\.gifEnabled\)/);
  assert.match(routeSource, /attachPrivateDmControls\(embeds/);
  assert.match(routeSource, /editDiscordMessage\(channelId, messageId, \{ embeds \}\)/);
});

test('parses only the five allowed control actions', () => {
  assert.equal(parsePrivateDmControlAction('g'), 'gif');
  assert.equal(parsePrivateDmControlAction('tts'), 'tts');
  assert.equal(parsePrivateDmControlAction('a'), 'adult');
  assert.equal(parsePrivateDmControlAction('settings'), 'settings');
  assert.equal(parsePrivateDmControlAction('delete'), 'delete');
  assert.equal(parsePrivateDmControlAction('d'), 'delete');
  assert.equal(parsePrivateDmControlAction('purge'), null);
});

test('splits long private TTS at readable boundaries', () => {
  const text = Array.from({ length: 35 }, (_, index) => `Sentence ${index} has enough words to sound natural.`).join(' ');
  const chunks = splitPrivateTtsText(text, 500);
  assert.ok(chunks.length > 1);
  assert.ok(chunks.length <= 4);
  assert.ok(chunks.every((chunk) => chunk.length <= 501));
  assert.equal(chunks.join(' ').replace(/\s+/g, ' ').trim(), text.replace(/\s+/g, ' ').trim());
});

test('settings and TTS controls redirect through the configured public app URL', () => {
  const routeSource = readFileSync(
    new URL('../src/app/private-chat/control/route.ts', import.meta.url),
    'utf8',
  );
  const apiRouteSource = readFileSync(
    new URL('../src/app/api/private-chat/control/route.ts', import.meta.url),
    'utf8',
  );

  assert.match(routeSource, /new URL\('\/private-chat', getConfiguredAppUrl\(\)\)/);
  assert.match(routeSource, /new URL\('\/private-chat\/tts', getConfiguredAppUrl\(\)\)/);
  assert.doesNotMatch(routeSource, /new URL\('\/bot-functions', request\.url\)/);
  assert.match(apiRouteSource, /redirectUrl: '\/private-chat'/);
  assert.match(apiRouteSource, /deleteMessage\(control\.channelId, control\.messageId\)/);
  assert.match(routeSource, /action !== 'delete'/);
  assert.match(apiRouteSource, /listPrivateAiTurnsAfter\(history, after, 4\)/);
  assert.match(apiRouteSource, /mode === 'poll'/);
  assert.match(apiRouteSource, /mode === 'off'/);
});

test('private TTS player keeps the say-style controls but listens only to private Athena polling', () => {
  const playerSource = readFileSync(
    new URL('../src/app/private-chat/tts/page.tsx', import.meta.url),
    'utf8',
  );

  assert.match(playerSource, /TTS_VOICE_OPTIONS/);
  assert.match(playerSource, /type="range"/);
  assert.match(playerSource, /Push to talk/);
  assert.match(playerSource, /mode: 'poll'/);
  assert.match(playerSource, /mode: 'off'/);
  assert.match(playerSource, /pagehide/);
  assert.doesNotMatch(playerSource, /\/api\/say\/next/);
  assert.doesNotMatch(playerSource, /\/api\/say\/chat/);
});
