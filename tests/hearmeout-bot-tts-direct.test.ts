import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

test('HearMeOut bot replies use a dedicated Say TTS stream while other surfaces keep direct persona TTS', async () => {
  const source = await readFile('src/app/api/spmt/bot/commands/route.ts', 'utf8');

  assert.match(source, /import \{ generateTTS \} from '@\/services\/tts-provider'/);
  assert.match(source, /import \{ DEFAULT_TTS_VOICE \} from '@\/lib\/tts-voices'/);
  assert.match(source, /function hearMeOutSayStreamKey/);
  assert.match(source, /hmo-say-/);
  assert.match(source, /source === 'hearmeout'/);
  assert.match(source, /useHearMeOutSay\s*\?\s*DEFAULT_TTS_VOICE/);
  assert.match(source, /source:\s*useHearMeOutSay \? 'say' : 'direct'/);
  assert.match(source, /HearMeOut Say/);
  assert.match(source, /await generateTTS\(/);
  assert.doesNotMatch(source, /postInternal\(request,\s*['"]\/api\/tts['"]/);
});
