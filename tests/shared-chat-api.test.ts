import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { NextRequest } from 'next/server';

import { serializeSessionCookie } from '../src/lib/session-cookie';
import { normalizeTwitchSharedChatEvent } from '../src/services/shared-chat-normalizers';
import { GET as getDeadLetters } from '../src/app/api/shared-chat/dead-letters/route';
import { GET as getReplay } from '../src/app/api/shared-chat/replay/route';
import { GET as getSpmtFeed } from '../src/app/api/shared-chat/spmt-feed/route';
import { POST as dispatchSpmtMessage } from '../src/app/api/shared-chat/spmt-dispatch/route';
import { normalizeSocialStreamSharedChatEvent } from '../src/lib/social-stream-normalizer';
import { normalizeYouTubeSharedChatEvent } from '../src/services/shared-chat-normalizers';

function signedTenantRequest(url: string, tenantId: string): NextRequest {
  const cookie = serializeSessionCookie({ id: tenantId, username: 'owner' });
  return new NextRequest(url, {
    headers: { cookie: `streamweaver-session=${cookie}` },
  });
}

test('shared chat replay API returns only the signed tenant replay window', async () => {
  const persistRoot = await mkdtemp(path.join(os.tmpdir(), 'streamweaver-shared-chat-api-'));
  const priorRoot = process.env.PERSIST_ROOT;
  const priorSecret = process.env.STREAMWEAVER_SESSION_SECRET;
  process.env.PERSIST_ROOT = persistRoot;
  process.env.STREAMWEAVER_SESSION_SECRET = 'test-session-secret-that-is-not-used-in-production';

  try {
    const { recordSharedChatEvent } = await import('../src/services/shared-chat-ingestion');
    await recordSharedChatEvent(normalizeTwitchSharedChatEvent({
      tenantId: 'tenant-api-a',
      channel: '#alpha',
      message: 'visible',
      tags: { id: 'msg-a', username: 'viewer-a' },
    }));
    await recordSharedChatEvent(normalizeTwitchSharedChatEvent({
      tenantId: 'tenant-api-b',
      channel: '#beta',
      message: 'hidden',
      tags: { id: 'msg-b', username: 'viewer-b' },
    }));

    const response = await getReplay(signedTenantRequest('https://streamweaver-new.fly.dev/api/shared-chat/replay?tenantId=tenant-api-b&limit=25', 'tenant-api-a'));
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.tenantId, 'tenant-api-a');
    assert.equal(body.count, 1);
    assert.equal(body.events[0].text, 'visible');
  } finally {
    if (priorRoot == null) delete process.env.PERSIST_ROOT; else process.env.PERSIST_ROOT = priorRoot;
    if (priorSecret == null) delete process.env.STREAMWEAVER_SESSION_SECRET; else process.env.STREAMWEAVER_SESSION_SECRET = priorSecret;
    await rm(persistRoot, { recursive: true, force: true });
  }
});

test('shared chat replay API supports platform, text, and cursor polling filters', async () => {
  const persistRoot = await mkdtemp(path.join(os.tmpdir(), 'streamweaver-shared-chat-api-filter-'));
  const priorRoot = process.env.PERSIST_ROOT;
  const priorSecret = process.env.STREAMWEAVER_SESSION_SECRET;
  process.env.PERSIST_ROOT = persistRoot;
  process.env.STREAMWEAVER_SESSION_SECRET = 'test-session-secret-that-is-not-used-in-production';

  try {
    const { recordSharedChatEvent } = await import('../src/services/shared-chat-ingestion');
    const first = normalizeTwitchSharedChatEvent({
      tenantId: 'tenant-filter',
      channel: '#alpha',
      message: 'first ordinary message',
      tags: { id: 'msg-1', username: 'viewer-a' },
    });
    const second = normalizeTwitchSharedChatEvent({
      tenantId: 'tenant-filter',
      channel: '#alpha',
      message: 'Professor Eevee vocaloid question',
      tags: { id: 'msg-2', username: 'viewer-b' },
    });
    await recordSharedChatEvent(first);
    await recordSharedChatEvent(second);

    const filteredResponse = await getReplay(signedTenantRequest(
      'https://streamweaver-new.fly.dev/api/shared-chat/replay?platform=twitch&q=vocaloid&limit=25',
      'tenant-filter',
    ));
    const filtered = await filteredResponse.json();
    assert.equal(filtered.count, 1);
    assert.equal(filtered.events[0].eventId, second.eventId);

    const cursorResponse = await getReplay(signedTenantRequest(
      `https://streamweaver-new.fly.dev/api/shared-chat/replay?after=${encodeURIComponent(first.eventId)}&limit=25`,
      'tenant-filter',
    ));
    const cursor = await cursorResponse.json();
    assert.equal(cursor.count, 1);
    assert.equal(cursor.events[0].eventId, second.eventId);
    assert.equal(cursor.replayWindow.nextCursor, second.eventId);
    assert.equal(cursor.replayWindow.cursorFound, true);
  } finally {
    if (priorRoot == null) delete process.env.PERSIST_ROOT; else process.env.PERSIST_ROOT = priorRoot;
    if (priorSecret == null) delete process.env.STREAMWEAVER_SESSION_SECRET; else process.env.STREAMWEAVER_SESSION_SECRET = priorSecret;
    await rm(persistRoot, { recursive: true, force: true });
  }
});

test('shared chat dead-letter API requires auth and redacts raw payloads by default', async () => {
  const persistRoot = await mkdtemp(path.join(os.tmpdir(), 'streamweaver-shared-chat-api-dl-'));
  const priorRoot = process.env.PERSIST_ROOT;
  const priorSecret = process.env.STREAMWEAVER_SESSION_SECRET;
  process.env.PERSIST_ROOT = persistRoot;
  process.env.STREAMWEAVER_SESSION_SECRET = 'test-session-secret-that-is-not-used-in-production';

  try {
    const unauthenticated = await getDeadLetters(new NextRequest('https://streamweaver-new.fly.dev/api/shared-chat/dead-letters'));
    assert.equal(unauthenticated.status, 401);

    const { recordSharedChatDeadLetter } = await import('../src/services/shared-chat-ingestion');
    await recordSharedChatDeadLetter({
      tenantId: 'tenant-api-dead-letter',
      source: 'discord',
      reason: 'bad payload',
      payload: { secretish: 'raw event body', nested: { id: '1' } },
    });

    const response = await getDeadLetters(signedTenantRequest('https://streamweaver-new.fly.dev/api/shared-chat/dead-letters', 'tenant-api-dead-letter'));
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.tenantId, 'tenant-api-dead-letter');
    assert.equal(body.count, 1);
    assert.equal(body.deadLetters[0].reason, 'bad payload');
    assert.equal(body.deadLetters[0].payload, undefined);
    assert.match(body.deadLetters[0].payloadPreview, /raw event body/);
  } finally {
    if (priorRoot == null) delete process.env.PERSIST_ROOT; else process.env.PERSIST_ROOT = priorRoot;
    if (priorSecret == null) delete process.env.STREAMWEAVER_SESSION_SECRET; else process.env.STREAMWEAVER_SESSION_SECRET = priorSecret;
    await rm(persistRoot, { recursive: true, force: true });
  }
});

test('SPMT feed requires the service key, stays tenant-isolated, and dedupes bridge copies', async () => {
  const persistRoot = await mkdtemp(path.join(os.tmpdir(), 'streamweaver-spmt-feed-'));
  const priorRoot = process.env.PERSIST_ROOT;
  const priorKey = process.env.SPMT_SYSTEM_KEY;
  process.env.PERSIST_ROOT = persistRoot;
  process.env.SPMT_SYSTEM_KEY = 'test-spmt-system-key';

  try {
    const unauthorized = await getSpmtFeed(new NextRequest('https://streamweaver-new.fly.dev/api/shared-chat/spmt-feed'));
    assert.equal(unauthorized.status, 401);

    const { recordSharedChatEvent } = await import('../src/services/shared-chat-ingestion');
    const native = normalizeYouTubeSharedChatEvent({
      tenantId: 'tenant-feed-a',
      liveChatId: 'live-chat-1',
      message: {
        id: 'yt-upstream-1',
        authorChannelId: 'viewer-1',
        authorDisplayName: 'Viewer One',
        message: 'one real message',
        timestamp: '2026-07-30T01:00:00.000Z',
        isSuperChat: false,
        isMembership: false,
      },
    });
    const bridge = normalizeSocialStreamSharedChatEvent({
      id: 'yt-upstream-1',
      type: 'youtube',
      chatname: 'Viewer One',
      userid: 'viewer-1',
      chatmessage: 'one real message',
      channelId: 'live-chat-1',
      timestamp: '2026-07-30T01:00:00.000Z',
    }, 'tenant-feed-a');
    assert.ok(bridge);
    await recordSharedChatEvent(native);
    await recordSharedChatEvent(bridge);
    await recordSharedChatEvent(normalizeTwitchSharedChatEvent({
      tenantId: 'tenant-feed-b',
      channel: '#hidden',
      message: 'other tenant',
      tags: { id: 'hidden-1', username: 'other-viewer' },
    }));

    const response = await getSpmtFeed(new NextRequest(
      'https://streamweaver-new.fly.dev/api/shared-chat/spmt-feed?limit=25&q=real',
      {
        headers: {
          'x-spmt-key': 'test-spmt-system-key',
          'x-spmt-tenant-id': 'tenant-feed-a',
        },
      },
    ));
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.tenantId, 'tenant-feed-a');
    assert.equal(body.mode, 'read-only');
    assert.equal(body.count, 1);
    assert.equal(body.events[0].text, 'one real message');
    assert.equal(body.events[0].meta.streamweaver.tenantId, 'tenant-feed-a');
    assert.equal(typeof body.events[0].meta.streamweaver.points, 'number');
    assert.equal(Array.isArray(body.events[0].meta.streamweaver.globalBadges), true);
    assert.equal(typeof body.events[0].meta.streamweaver.cards.total, 'number');
    assert.equal(body.events.some((event: any) => event.text === 'other tenant'), false);
    assert.equal(body.channels.some((channel: any) => channel.platform === 'youtube'), true);
    assert.equal(body.sources.some((source: any) => source.platform === 'tiktok' && source.readOnly === true), true);
    assert.equal(body.sources.every((source: any) => source.readOnly === true), true);
    assert.equal(Array.isArray(body.commands), true);
  } finally {
    if (priorRoot == null) delete process.env.PERSIST_ROOT; else process.env.PERSIST_ROOT = priorRoot;
    if (priorKey == null) delete process.env.SPMT_SYSTEM_KEY; else process.env.SPMT_SYSTEM_KEY = priorKey;
    await rm(persistRoot, { recursive: true, force: true });
  }
});

test('SPMT dispatch rejects unverified destinations and reports unproven adapters truthfully', async () => {
  const persistRoot = await mkdtemp(path.join(os.tmpdir(), 'streamweaver-spmt-dispatch-'));
  const priorRoot = process.env.PERSIST_ROOT;
  const priorKey = process.env.SPMT_SYSTEM_KEY;
  process.env.PERSIST_ROOT = persistRoot;
  process.env.SPMT_SYSTEM_KEY = 'test-spmt-system-key';

  const request = (body: unknown, key = 'test-spmt-system-key') => new NextRequest(
    'https://streamweaver-new.fly.dev/api/shared-chat/spmt-dispatch',
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-spmt-key': key,
        'x-spmt-tenant-id': 'tenant-dispatch',
      },
      body: JSON.stringify(body),
    },
  );

  try {
    const unauthorized = await dispatchSpmtMessage(request({
      idempotencyKey: 'dispatch-unauthorized',
      destination: { platform: 'twitch', channelId: 'alpha', channelName: 'alpha' },
      message: 'no',
    }, 'wrong'));
    assert.equal(unauthorized.status, 401);

    const unverified = await dispatchSpmtMessage(request({
      idempotencyKey: 'dispatch-unverified',
      destination: { platform: 'twitch', channelId: 'alpha', channelName: 'alpha' },
      message: 'no',
    }));
    assert.equal(unverified.status, 409);
    assert.equal((await unverified.json()).code, 'DESTINATION_NOT_VERIFIED');

    const { recordSharedChatEvent } = await import('../src/services/shared-chat-ingestion');
    await recordSharedChatEvent(normalizeYouTubeSharedChatEvent({
      tenantId: 'tenant-dispatch',
      liveChatId: 'youtube-live-1',
      channelName: 'youtube-live-1',
      message: {
        id: 'youtube-message-1',
        authorChannelId: 'viewer-1',
        authorDisplayName: 'Viewer One',
        message: 'hello',
        timestamp: '2026-07-30T02:00:00.000Z',
        isSuperChat: false,
        isMembership: false,
      },
    }));
    const unavailable = await dispatchSpmtMessage(request({
      idempotencyKey: 'dispatch-youtube-unavailable',
      destination: { platform: 'youtube', channelId: 'youtube-live-1', channelName: 'youtube-live-1' },
      message: 'safe refusal',
    }));
    assert.equal(unavailable.status, 409);
    assert.equal((await unavailable.json()).code, 'ADAPTER_UNAVAILABLE');
  } finally {
    if (priorRoot == null) delete process.env.PERSIST_ROOT; else process.env.PERSIST_ROOT = priorRoot;
    if (priorKey == null) delete process.env.SPMT_SYSTEM_KEY; else process.env.SPMT_SYSTEM_KEY = priorKey;
    await rm(persistRoot, { recursive: true, force: true });
  }
});
