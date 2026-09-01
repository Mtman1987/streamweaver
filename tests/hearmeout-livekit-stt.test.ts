import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

async function source(path: string) {
  return readFile(path, 'utf8');
}

test('HearMeOut STT uses the working Eden AI credential before legacy fallbacks', async () => {
  const speech = await source('src/services/speech.ts');

  assert.match(speech, /EDENAI_API_KEY/);
  assert.match(speech, /\/v2\/audio\/speech_to_text_async/);
  assert.match(speech, /providers['"],\s*EDEN_STT_PROVIDER/);
  assert.match(speech, /EDEN_STT_PROVIDER = ['"]openai['"]/);
  assert.match(speech, /new Blob\(/);
  assert.match(speech, /provider: ['"]edenai-openai['"]/);
  assert.match(speech, /getBrokerBaseUrl\(\)/);
  assert.match(speech, /SpeechClient/);
});

test('HearMeOut persona source variants converge on Say TTS', async () => {
  const botRoute = await source('src/app/api/spmt/bot/commands/route.ts');
  const serviceRoute = await source('src/app/api/internal/hearmeout/persona-command/route.ts');

  assert.match(botRoute, /source\.startsWith\(['"]hearmeout-['"]\)/);
  assert.match(botRoute, /return ['"]hearmeout['"]/);
  assert.match(botRoute, /useHearMeOutSay\s*=\s*source === ['"]hearmeout['"]/);

  assert.match(serviceRoute, /DEFAULT_TTS_VOICE/);
  assert.match(serviceRoute, /hmo-say-/);
  assert.match(serviceRoute, /generateTTS\([\s\S]*DEFAULT_TTS_VOICE[\s\S]*sayStreamKey/);
  assert.match(serviceRoute, /source:\s*['"]say['"]/);
});
