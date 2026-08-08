import assert from 'node:assert/strict';
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

test('creates four emoji-only markdown links without Discord buttons', () => {
  const field = buildPrivateDmControlField({
    channelId,
    messageId,
    nowSeconds: 1_000,
  });
  assert.equal(field.name, PRIVATE_DM_CONTROL_FIELD_NAME);
  assert.equal(field.inline, false);
  assert.ok(field.value.length <= 1024);
  assert.equal((field.value.match(/\]\(https:\/\//g) || []).length, 4);
  assert.match(field.value, /\[🖼️\]/u);
  assert.match(field.value, /\[🔊\]/u);
  assert.match(field.value, /\[🔞\]/u);
  assert.match(field.value, /\[⚙️\]/u);
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

test('parses only the four allowed control actions', () => {
  assert.equal(parsePrivateDmControlAction('g'), 'gif');
  assert.equal(parsePrivateDmControlAction('tts'), 'tts');
  assert.equal(parsePrivateDmControlAction('a'), 'adult');
  assert.equal(parsePrivateDmControlAction('settings'), 'settings');
  assert.equal(parsePrivateDmControlAction('delete'), null);
});

test('splits long private TTS at readable boundaries', () => {
  const text = Array.from({ length: 140 }, (_, index) => `Sentence ${index} has enough words to sound natural.`).join(' ');
  const chunks = splitPrivateTtsText(text, 500);
  assert.ok(chunks.length > 1);
  assert.ok(chunks.length <= 4);
  assert.ok(chunks.every((chunk) => chunk.length <= 501));
  assert.equal(chunks.join(' ').replace(/\s+/g, ' ').trim(), text.replace(/\s+/g, ' ').trim());
});
