import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveAthenaConversationId,
  trustedVisibilityForSurface,
} from '../src/services/athena-contract';

test('Athena derives visibility only from the trusted surface', () => {
  assert.equal(trustedVisibilityForSurface('twitch-chat'), 'public');
  assert.equal(trustedVisibilityForSurface('kick-chat'), 'public');
  assert.equal(trustedVisibilityForSurface('discord-channel'), 'public');

  assert.equal(trustedVisibilityForSurface('discord-dm'), 'private');
  assert.equal(trustedVisibilityForSurface('streamweaver-private'), 'private');
  assert.equal(trustedVisibilityForSurface('rotator-workbench'), 'private');
  assert.equal(trustedVisibilityForSurface('mountainview'), 'private');
  assert.equal(trustedVisibilityForSurface('app-layout'), 'private');
});

test('Athena conversation IDs are stable and separate public audiences from private participants', () => {
  const publicId = deriveAthenaConversationId({
    tenantId: 'tenant 1',
    visibility: 'public',
    actor: { username: 'viewer-one', userId: 'viewer-1' },
    location: { surface: 'twitch-chat', channelName: 'Captain Channel' },
  });
  const otherViewerPublicId = deriveAthenaConversationId({
    tenantId: 'tenant 1',
    visibility: 'public',
    actor: { username: 'viewer-two', userId: 'viewer-2' },
    location: { surface: 'twitch-chat', channelName: 'Captain Channel' },
  });
  const privateId = deriveAthenaConversationId({
    tenantId: 'tenant 1',
    visibility: 'private',
    actor: { username: 'viewer-one', userId: 'viewer-1' },
    location: { surface: 'discord-dm', channelId: 'dm-123' },
  });

  assert.equal(publicId, otherViewerPublicId);
  assert.notEqual(publicId, privateId);
  assert.match(publicId, /^tenant-1:twitch-chat:captain-channel:audience$/);
  assert.match(privateId, /^tenant-1:discord-dm:dm-123:viewer-1$/);
});
