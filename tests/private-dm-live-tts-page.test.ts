import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('private DM TTS player stays Athena-only and keeps say-style controls', () => {
  const source = readFileSync(
    new URL('../src/app/private-chat/tts/page.tsx', import.meta.url),
    'utf8',
  );

  assert.match(source, /TTS_VOICE_OPTIONS/);
  assert.match(source, /type="range"/);
  assert.match(source, /Push to talk/);
  assert.match(source, /mode: 'poll'/);
  assert.match(source, /mode: 'off'/);
  assert.match(source, /pagehide/);
  assert.match(source, /Current Discord-style embed/);
  assert.doesNotMatch(source, /\/api\/say\/next/);
  assert.doesNotMatch(source, /\/api\/say\/chat/);
});
