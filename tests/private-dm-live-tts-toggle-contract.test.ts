import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('private TTS signed control supports idempotent start, private submit, voice test, poll and stop', () => {
  const source = readFileSync(
    new URL('../src/app/api/private-chat/control/route.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /writePrivateChatSettings\(\{ ttsEnabled: !current\.ttsEnabled \}/);
  assert.match(source, /mode === 'poll'/);
  assert.match(source, /mode === 'off'/);
  assert.match(source, /const next = mode === 'on'/);
  assert.match(source, /mode === 'send'/);
  assert.match(source, /mode === 'test'/);
  assert.match(source, /sendStructuredDiscordReply\\(\\{/);
  assert.match(source, /sourceMessage: transcript/);
  assert.match(source, /sourceUserAvatarUrl/);
  assert.match(source, /api\\/private-chat\\/respond/);
  assert.match(source, /privateVoiceCatalog/);
  assert.match(source, /PRIVATE_AI_PAUSED/);
  assert.match(source, /readPrivateChatMessages\(60, tenantId\)/);
  assert.match(source, /generatePrivateAudio\(turn\.text, tenantId, selectedVoice\)/);
});
