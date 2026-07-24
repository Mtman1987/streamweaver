import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SHARED_CHAT_EVENT_VERSION,
  makeSharedChatDedupeKey,
  parseSharedChatEventV1,
} from '../src/contracts/shared-chat-event';

const baseEvent = {
  version: SHARED_CHAT_EVENT_VERSION,
  eventId: 'evt_tenant_a_twitch_123',
  upstreamId: 'twitch-msg-123',
  tenantId: 'tenant-a',
  platform: 'twitch',
  sourceId: 'twitch:space_mountain',
  sourceName: 'Space Mountain',
  channelId: '94371378',
  channelName: 'spacemountain',
  type: 'message',
  sender: {
    id: '767875979561009173',
    login: 'mtman1987',
    displayName: 'Mtman1987',
    avatarUrl: 'https://example.com/avatar.png',
    badges: [{ id: 'founder', label: 'Founder' }],
    roles: ['owner', 'viewer'],
  },
  text: 'athena check this',
  sanitizedHtml: 'athena check this',
  media: [],
  links: [],
  originalTimestamp: '2026-07-24T12:00:00.000Z',
  receivedTimestamp: '2026-07-24T12:00:01.000Z',
  meta: { rawProvider: 'tmi' },
  dedupeKey: makeSharedChatDedupeKey({
    tenantId: 'tenant-a',
    platform: 'twitch',
    sourceId: 'twitch:space_mountain',
    channelId: '94371378',
    upstreamId: 'twitch-msg-123',
  }),
  routing: {
    mirrored: false,
    reflected: false,
    canReply: true,
    replyTarget: 'twitch:94371378',
    botReadable: true,
    botCanReply: false,
    tenantIsolationKey: 'tenant-a',
  },
} as const;

test('SharedChatEventV1 parses a normalized live message', () => {
  const parsed = parseSharedChatEventV1(baseEvent);

  assert.equal(parsed.version, SHARED_CHAT_EVENT_VERSION);
  assert.equal(parsed.dedupeKey, 'shared-chat-event.v1:tenant-a:twitch:twitch:space_mountain:94371378:twitch-msg-123');
  assert.equal(parsed.routing.tenantIsolationKey, 'tenant-a');
  assert.equal(parsed.sender.roles.includes('owner'), true);
});

test('SharedChatEventV1 rejects missing tenant isolation', () => {
  const invalid = {
    ...baseEvent,
    routing: {
      ...baseEvent.routing,
      tenantIsolationKey: '',
    },
  };

  assert.throws(() => parseSharedChatEventV1(invalid), /tenantIsolationKey/);
});

test('SharedChatEventV1 accepts non-chat monetization context without mixing message types', () => {
  const parsed = parseSharedChatEventV1({
    ...baseEvent,
    eventId: 'evt_tenant_a_youtube_superchat_1',
    upstreamId: 'youtube-superchat-1',
    platform: 'youtube',
    sourceId: 'youtube:space_mountain',
    channelId: 'youtube-channel-1',
    type: 'donation',
    text: 'great stream',
    donation: {
      amount: 10,
      currency: 'USD',
      display: '$10.00',
    },
    dedupeKey: makeSharedChatDedupeKey({
      tenantId: 'tenant-a',
      platform: 'youtube',
      sourceId: 'youtube:space_mountain',
      channelId: 'youtube-channel-1',
      upstreamId: 'youtube-superchat-1',
    }),
  });

  assert.equal(parsed.type, 'donation');
  assert.equal(parsed.donation?.currency, 'USD');
});
