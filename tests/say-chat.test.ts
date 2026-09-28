import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { buildSayChatSpeech, resolveSayChatIdentity } from '../src/services/say-chat';
import { resolveSayStreamKey } from '../src/services/say-tts';

test('speech-to-chat uses the signed display name and avatar', () => {
  const identity = resolveSayChatIdentity({
    tenantId: 'tenant-1',
    username: 'mtman1987',
    displayName: 'Mtman1987',
    avatar: 'https://cdn.example.com/mtman.png',
  });

  assert.deepEqual(identity, {
    username: 'Mtman1987',
    avatarUrl: 'https://cdn.example.com/mtman.png',
  });
  assert.equal(buildSayChatSpeech(identity, 'What about this?'), 'Mtman said: What about this?');
});

test('speech-to-chat falls back to the signed username', () => {
  const identity = resolveSayChatIdentity({
    tenantId: 'tenant-2',
    username: 'mothermayrien',
  });

  assert.deepEqual(identity, { username: 'mothermayrien', avatarUrl: undefined });
  assert.equal(buildSayChatSpeech(identity, 'hello there'), 'mothermayrien said: hello there');
});


test('SpaceMountain Twitch chat and Lounge browser source share one public TTS lane', () => {
  assert.equal(resolveSayStreamKey(undefined, 'twitch', 'spacemountainlive'), 'spacemountainlive');
  assert.equal(resolveSayStreamKey('spacemountainlive', 'twitch', 'spacemountainlive'), 'spacemountainlive');
  assert.equal(resolveSayStreamKey(undefined, 'twitch', 'otherchannel'), 'twitch:otherchannel');
});


test('speech-to-chat marks Twitch sends as already queued for TTS', () => {
  const route = readFileSync(new URL('../src/app/api/say/chat/route.ts', import.meta.url), 'utf8');
  const serverRoutes = readFileSync(new URL('../src/server/routes.ts', import.meta.url), 'utf8');
  const dispatcher = readFileSync(new URL('../src/services/chat-dispatcher.ts', import.meta.url), 'utf8');

  assert.match(route, /suppressSayTts: true/);
  assert.match(serverRoutes, /suppressNextSayEcho\(channel, suppressEchoSpeaker, message\)/);
  assert.match(serverRoutes, /cancelNextSayEcho\(channel, suppressEchoSpeaker, message\)/);
  assert.match(dispatcher, /!consumeNextSayEcho\(replyChannel, actualUsername, actualMessage\)/);
});
