import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTwitchSharedChatEvent } from '../src/services/shared-chat-normalizers';
import { projectPublicTwitchMessage, isCommunityComposeDestination } from '../src/services/commlink-community-chats';
import { readFileSync } from 'node:fs';
const chat = { tenantId: 'tenant-b', channelId: '12345', channelName: 'bob' };
const event = () => normalizeTwitchSharedChatEvent({ tenantId: chat.tenantId, channel: '#bob', message: 'Public hello', tags: { id: 'msg1', username: 'viewer', 'room-id': '12345' } });

test('public Twitch projection includes the message but strips tenant-owned enrichment and metadata', () => {
  const input = event();
  input.meta = { ...input.meta, streamweaver: { points: 900, privateMemory: 'private' }, secret: 'private' };
  const projected = projectPublicTwitchMessage(input, chat, 'tenant-a')!;
  assert.equal(projected.text, 'Public hello');
  assert.deepEqual(projected.meta, { publicCommunityChat: true });
  assert.equal(projected.tenantId, 'tenant-a');
  assert.equal(projected.routing.canReply, false);
  assert.equal(projected.routing.botReadable, false);
  assert.ok(!JSON.stringify(projected).includes('private'));
});

test('private, foreign-channel, non-native and non-chat records never enter the community view', () => {
  const input = event();
  for (const changed of [
    { platform: 'discord' }, { platform: 'app' }, { tenantId: 'tenant-c' },
    { sourceId: 'twitch:private' }, { channelName: 'someoneelse' }, { type: 'system' },
    { meta: { rawProvider: 'bridge' } },
  ]) assert.equal(projectPublicTwitchMessage({ ...input, ...changed } as any, chat, 'tenant-a'), null);
});

test('an existing registered channel is selectable without replay, but a forged id or channel is rejected', () => {
  assert.equal(isCommunityComposeDestination({ platform: 'twitch', channelId: '12345', channelName: 'bob' }, [chat]), true);
  for (const destination of [
    { platform: 'discord', channelId: '12345', channelName: 'bob' },
    { platform: 'twitch', channelId: '54321', channelName: 'bob' },
    { platform: 'twitch', channelId: '12345', channelName: 'alice' },
  ]) assert.equal(isCommunityComposeDestination(destination, [chat]), false);
});

test('community access allows compose only; moderation retains the original tenant replay boundary', () => {
  const route = readFileSync('src/app/api/shared-chat/spmt-dispatch/route.ts', 'utf8');
  assert.match(route, /input.action === 'compose' && isCommunityComposeDestination/);
  assert.match(route, /if \(!matchingEvents.length && !communityCompose\)/);
  const runtime = readFileSync('src/server/routes.ts', 'utf8');
  assert.equal((runtime.match(/if \(!client && !isCountSend && !requestedTenantId\)/g) || []).length, 2);
  const clients = readFileSync('src/services/twitch-client.ts', 'utf8');
  assert.match(clients, /channel.replace\(\/\^#\/, ''\).toLowerCase\(\) !== broadcasterUsername.toLowerCase\(\)/);
});
