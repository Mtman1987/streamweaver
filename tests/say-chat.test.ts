import test from 'node:test';
import assert from 'node:assert/strict';

import { buildSayChatSpeech, resolveSayChatIdentity } from '../src/services/say-chat';

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
