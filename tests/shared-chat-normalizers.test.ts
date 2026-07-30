import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeDiscordSharedChatEvent, normalizeKickSharedChatEvent, normalizeTwitchSharedChatEvent, normalizeYouTubeSharedChatEvent } from '../src/services/shared-chat-normalizers';
import { normalizeSocialStreamSharedChatEvent } from '../src/lib/social-stream-normalizer';

test('normalizes Twitch IRC payloads into tenant-isolated shared chat events', () => {
  const event = normalizeTwitchSharedChatEvent({
    tenantId: '94371278',
    channel: '#space_mountain',
    message: 'athena check https://spacemountain.live',
    self: false,
    tags: {
      id: 'twitch-message-1',
      'room-id': 'room-1',
      'user-id': '767875979561009173',
      username: 'mtman1987',
      'display-name': 'Mtman1987',
      'tmi-sent-ts': '1784910000000',
      badges: { broadcaster: '1', founder: '0' },
      emotes: { '25': ['0-4'] },
    },
  });

  assert.equal(event.tenantId, '94371278');
  assert.equal(event.platform, 'twitch');
  assert.equal(event.sourceId, 'twitch:space_mountain');
  assert.equal(event.channelId, 'room-1');
  assert.equal(event.sender.roles.includes('broadcaster'), true);
  assert.equal(event.sender.roles.includes('subscriber'), true);
  assert.equal(event.links[0]?.url, 'https://spacemountain.live');
  assert.equal(event.media[0]?.type, 'emote');
  assert.match(event.media[0]?.url || '', /emoticons\/v2\/25/);
  assert.equal(event.routing.tenantIsolationKey, '94371278');
});

test('preserves Twitch channel-point, bits, and reply fidelity', () => {
  const reward = normalizeTwitchSharedChatEvent({
    tenantId: 'tenant-reward',
    channel: '#alpha',
    message: 'hydrate',
    tags: {
      id: 'reward-message',
      username: 'viewer',
      'custom-reward-id': 'reward-1',
      'custom-reward-title': 'Hydrate',
    },
  });
  assert.equal(reward.type, 'reward');
  assert.equal(reward.reward?.id, 'reward-1');
  assert.equal(reward.reward?.title, 'Hydrate');

  const bits = normalizeTwitchSharedChatEvent({
    tenantId: 'tenant-bits',
    channel: '#alpha',
    message: 'cheer100',
    tags: { id: 'bits-message', username: 'viewer', bits: '100' },
  });
  assert.equal(bits.type, 'donation');
  assert.equal(bits.donation?.amount, 100);
  assert.equal(bits.donation?.currency, 'BITS');

  const reply = normalizeTwitchSharedChatEvent({
    tenantId: 'tenant-reply',
    channel: '#alpha',
    message: 'yes',
    tags: {
      id: 'reply-message',
      username: 'viewer',
      'reply-parent-msg-id': 'parent-1',
      'reply-parent-display-name': 'Other Viewer',
      'reply-parent-msg-body': 'are you ready?',
    },
  });
  assert.equal(reply.type, 'reply');
  assert.equal(reply.reply?.eventId, 'parent-1');
  assert.equal(reply.reply?.senderName, 'Other Viewer');
});

test('normalizes Discord only with explicit tenant id and keeps guild id as source metadata', () => {
  const event = normalizeDiscordSharedChatEvent({
    tenantId: '94371278',
    message: 'athena hello',
    traceId: 'trace-1',
    payload: {
      guildId: '62633402',
      channelId: '1529967135605129369',
      messageId: 'message-1',
      userId: '767875979561009173',
      username: 'mtman1987',
      displayName: 'Mtman',
      isOwner: true,
      createdAt: '2026-07-24T12:00:00.000Z',
      attachments: [{ url: 'https://example.com/image.png', content_type: 'image/png', filename: 'image.png' }],
    },
  });

  assert.equal(event.tenantId, '94371278');
  assert.equal(event.sourceId, 'discord:62633402');
  assert.equal(event.channelId, 'discord:1529967135605129369');
  assert.equal(event.meta.guildId, '62633402');
  assert.equal(event.media[0]?.url, 'https://example.com/image.png');
  assert.equal(event.routing.tenantIsolationKey, '94371278');
  assert.notEqual(event.tenantId, event.meta.guildId);
});

test('normalizes YouTube and Kick messages without inventing missing money currency', () => {
  const youtube = normalizeYouTubeSharedChatEvent({
    tenantId: 'tenant-y',
    liveChatId: 'live-chat-1',
    message: {
      id: 'yt-1',
      authorChannelId: 'author-1',
      authorDisplayName: 'Viewer',
      message: 'great stream',
      timestamp: '2026-07-24T12:00:00.000Z',
      isSuperChat: true,
      superChatAmount: 10,
    },
  });
  assert.equal(youtube.type, 'donation');
  assert.equal(youtube.donation, undefined);

  const kick = normalizeKickSharedChatEvent({
    tenantId: 'tenant-k',
    channelName: 'Space_Mountain',
    message: {
      id: 'kick-1',
      username: 'viewer1',
      displayName: 'Viewer1',
      message: 'hello',
      timestamp: new Date('2026-07-24T12:00:00.000Z'),
      isModerator: true,
    },
  });
  assert.equal(kick.sourceId, 'kick:space_mountain');
  assert.equal(kick.sender.roles.includes('moderator'), true);
});

test('normalizes Social Stream Ninja messages into the shared tenant contract', () => {
  const event = normalizeSocialStreamSharedChatEvent({
    id: 'ssn-message-1',
    type: 'youtube',
    chatname: 'VocaloidFan',
    chatmessage: 'Miku time https://example.com/song',
    channelId: 'live-chat-123',
    channelName: 'Professor Eevee',
    timestamp: 1785191755000,
    chatimg: 'https://example.com/avatar.png',
  }, 'tenant-eevee');

  assert.ok(event);
  assert.equal(event.tenantId, 'tenant-eevee');
  assert.equal(event.platform, 'social-stream');
  assert.equal(event.sourceId, 'social-stream:youtube');
  assert.equal(event.channelId, 'live-chat-123');
  assert.equal(event.sender.displayName, 'VocaloidFan');
  assert.equal(event.links[0]?.url, 'https://example.com/song');
  assert.equal(event.routing.canReply, false);
  assert.equal(event.routing.tenantIsolationKey, 'tenant-eevee');
});
