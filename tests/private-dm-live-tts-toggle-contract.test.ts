import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('private TTS signed control toggles on open and supports explicit poll/off modes', () => {
  const source = readFileSync(
    new URL('../src/app/api/private-chat/control/route.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /writePrivateChatSettings\(\{ ttsEnabled: !current\.ttsEnabled \}/);
  assert.match(source, /mode === 'poll'/);
  assert.match(source, /mode === 'off'/);
  assert.match(source, /readPrivateChatMessages\(60, tenantId\)/);
  assert.match(source, /generatePrivateAudio\(turn\.text, tenantId, selectedVoice\)/);
});
