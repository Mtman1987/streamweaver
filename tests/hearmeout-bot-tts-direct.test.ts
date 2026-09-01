import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

test('HearMeOut bot replies synthesize TTS directly instead of looping through the local HTTP TTS route', async () => {
  const source = await readFile('src/app/api/spmt/bot/commands/route.ts', 'utf8');

  assert.match(source, /import \{ generateTTS \} from '@\/services\/tts-provider'/);
  assert.match(source, /await generateTTS\(/);
  assert.doesNotMatch(source, /postInternal\(request,\s*['"]\/api\/tts['"]/);
  assert.match(source, /source:\s*['"]direct['"]/);
  assert.match(source, /Direct TTS generation failed/);
});
