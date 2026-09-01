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

test('HearMeOut public persona routes never require a service secret or SPMT login', async () => {
  const galleryRoute = await source('src/app/api/internal/hearmeout/bots/route.ts');
  const serviceRoute = await source('src/app/api/internal/hearmeout/persona-command/route.ts');

  for (const route of [galleryRoute, serviceRoute]) {
    assert.doesNotMatch(route, /hasInternalServiceAccess/);
    assert.doesNotMatch(route, /STREAMWEAVER_SECRET/);
    assert.doesNotMatch(route, /SPMT_AUTH_REQUIRED/);
    assert.doesNotMatch(route, /getBotShareMode/);
  }
  assert.match(serviceRoute, /role:\s*['"]guest['"]/);
  assert.doesNotMatch(serviceRoute, /actorRole\(body\?\.actorRole\)/);
});

test('HearMeOut public persona gallery lists every configured tenant without bot-share gating', async () => {
  const galleryRoute = await source('src/app/api/internal/hearmeout/bots/route.ts');

  assert.match(galleryRoute, /listTenants\(\)/);
  assert.match(galleryRoute, /getBotSettings\(tenantId\)/);
  assert.doesNotMatch(galleryRoute, /getBotShareMode/);
  assert.doesNotMatch(galleryRoute, /shareMode/);
  assert.match(galleryRoute, /ownerName/);
  assert.match(galleryRoute, /interests/);
  assert.match(galleryRoute, /canInvite:\s*!countBlocked/);
  assert.match(galleryRoute, /canTalk:\s*!countBlocked/);
});

test('The Count is always visible and is the only explicitly blocked public HearMeOut persona conversation', async () => {
  const galleryRoute = await source('src/app/api/internal/hearmeout/bots/route.ts');
  const serviceRoute = await source('src/app/api/internal/hearmeout/persona-command/route.ts');

  assert.match(galleryRoute, /THE_COUNT_NAME/);
  assert.match(galleryRoute, /THE_COUNT_TWITCH_LOGIN/);
  assert.match(galleryRoute, /The Count is a system persona, not necessarily a normal tenant/);
  assert.match(galleryRoute, /id:\s*THE_COUNT_TWITCH_LOGIN/);
  assert.match(galleryRoute, /canInvite:\s*false/);
  assert.match(galleryRoute, /canTalk:\s*false/);
  assert.match(galleryRoute, /The Count is not available for public conversation/);
  assert.match(serviceRoute, /THE_COUNT_CHAT_DISABLED/);
  assert.match(serviceRoute, /The Count does not participate in public persona conversations/);
});
