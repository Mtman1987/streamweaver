import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { NextRequest } from 'next/server';

import { serializeSessionCookie } from '../src/lib/session-cookie';
import { normalizeTwitchSharedChatEvent } from '../src/services/shared-chat-normalizers';
import { GET as getFeatured } from '../src/app/api/shared-chat/featured/route';
import { GET as getStream } from '../src/app/api/shared-chat/stream/route';
import { GET as getUserState, PUT as putUserState } from '../src/app/api/shared-chat/user-state/route';
import { normalizeSocialStreamBridgeConfig } from '../scripts/social-stream-supervisor';
import { middleware } from '../src/middleware';

function signedRequest(url: string, tenantId: string, body?: unknown, signal?: AbortSignal): NextRequest {
  const cookie = serializeSessionCookie({ id: tenantId, username: 'operator-one' });
  return new NextRequest(url, {
    method: body ? 'PUT' : 'GET',
    signal,
    headers: {
      cookie: `streamweaver-session=${cookie}`,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

test('shared chat saves filters and a read cursor per signed user', async () => {
  const persistRoot = await mkdtemp(path.join(os.tmpdir(), 'streamweaver-chat-user-state-'));
  const priorRoot = process.env.PERSIST_ROOT;
  const priorSecret = process.env.STREAMWEAVER_SESSION_SECRET;
  process.env.PERSIST_ROOT = persistRoot;
  process.env.STREAMWEAVER_SESSION_SECRET = 'test-session-secret-that-is-not-used-in-production';
  try {
    const { recordSharedChatEvent } = await import('../src/services/shared-chat-ingestion');
    const event = normalizeTwitchSharedChatEvent({
      tenantId: 'tenant-user-state',
      channel: '#alpha',
      message: 'save me',
      tags: { id: 'state-message', username: 'viewer' },
    });
    await recordSharedChatEvent(event);
    const update = await putUserState(signedRequest(
      'https://streamweaver.test/api/shared-chat/user-state',
      'tenant-user-state',
      {
        lastReadEventId: event.eventId,
        savedFilters: [{ id: 'mods', name: 'Moderator view', platform: 'twitch', query: 'help' }],
      },
    ));
    assert.equal(update.status, 200);
    const body = await (await getUserState(signedRequest(
      'https://streamweaver.test/api/shared-chat/user-state',
      'tenant-user-state',
    ))).json();
    assert.equal(body.state.lastReadEventId, event.eventId);
    assert.equal(body.state.savedFilters[0].name, 'Moderator view');
  } finally {
    if (priorRoot == null) delete process.env.PERSIST_ROOT; else process.env.PERSIST_ROOT = priorRoot;
    if (priorSecret == null) delete process.env.STREAMWEAVER_SESSION_SECRET; else process.env.STREAMWEAVER_SESSION_SECRET = priorSecret;
    await rm(persistRoot, { recursive: true, force: true });
  }
});

test('shared chat SSE emits normalized replay with authenticated no-buffer headers', async () => {
  const persistRoot = await mkdtemp(path.join(os.tmpdir(), 'streamweaver-chat-sse-'));
  const priorRoot = process.env.PERSIST_ROOT;
  const priorSecret = process.env.STREAMWEAVER_SESSION_SECRET;
  process.env.PERSIST_ROOT = persistRoot;
  process.env.STREAMWEAVER_SESSION_SECRET = 'test-session-secret-that-is-not-used-in-production';
  const controller = new AbortController();
  try {
    const { recordSharedChatEvent } = await import('../src/services/shared-chat-ingestion');
    const event = normalizeTwitchSharedChatEvent({
      tenantId: 'tenant-sse',
      channel: '#alpha',
      message: 'live update',
      tags: { id: 'sse-message', username: 'viewer' },
    });
    await recordSharedChatEvent(event);
    const response = await getStream(signedRequest(
      'https://streamweaver.test/api/shared-chat/stream',
      'tenant-sse',
      undefined,
      controller.signal,
    ));
    assert.match(response.headers.get('content-type') || '', /text\/event-stream/);
    assert.equal(response.headers.get('x-accel-buffering'), 'no');
    const reader = response.body!.getReader();
    const first = await reader.read();
    const text = new TextDecoder().decode(first.value);
    assert.match(text, /event: chat/);
    assert.match(text, /live update/);
    controller.abort();
    await reader.cancel();
  } finally {
    controller.abort();
    if (priorRoot == null) delete process.env.PERSIST_ROOT; else process.env.PERSIST_ROOT = priorRoot;
    if (priorSecret == null) delete process.env.STREAMWEAVER_SESSION_SECRET; else process.env.STREAMWEAVER_SESSION_SECRET = priorSecret;
    await rm(persistRoot, { recursive: true, force: true });
  }
});

test('featured message output expires and advances the persisted queue', async () => {
  const persistRoot = await mkdtemp(path.join(os.tmpdir(), 'streamweaver-chat-featured-'));
  const priorRoot = process.env.PERSIST_ROOT;
  process.env.PERSIST_ROOT = persistRoot;
  try {
    const { recordSharedChatEvent } = await import('../src/services/shared-chat-ingestion');
    const { writeSharedChatOperatorState } = await import('../src/services/shared-chat-operator-state');
    const first = normalizeTwitchSharedChatEvent({
      tenantId: 'tenant-featured', channel: '#alpha', message: 'first',
      tags: { id: 'featured-first', username: 'viewer-a' },
    });
    const second = normalizeTwitchSharedChatEvent({
      tenantId: 'tenant-featured', channel: '#alpha', message: 'second',
      tags: { id: 'featured-second', username: 'viewer-b' },
    });
    await recordSharedChatEvent(first);
    await recordSharedChatEvent(second);
    await writeSharedChatOperatorState('tenant-featured', {
      pinnedEventIds: [],
      queuedEventIds: [second.eventId],
      featuredEventId: first.eventId,
      autoShow: false,
      autoAdvance: true,
      featureDurationSeconds: 1,
      featureStyle: 'minimal',
      featuredAt: new Date(Date.now() - 5_000).toISOString(),
    });
    const response = await getFeatured(new NextRequest(
      'https://streamweaver.test/api/shared-chat/featured?tenant=tenant-featured',
    ));
    const body = await response.json();
    assert.equal(body.event.eventId, second.eventId);
    assert.equal(body.presentation.style, 'minimal');
  } finally {
    if (priorRoot == null) delete process.env.PERSIST_ROOT; else process.env.PERSIST_ROOT = priorRoot;
    await rm(persistRoot, { recursive: true, force: true });
  }
});

test('Social Stream supervisor accepts one safe public mapping per tenant', () => {
  const configs = normalizeSocialStreamBridgeConfig([
    { tenantId: 'tenant-a', sessionId: 'session-a', channel: '4', enabled: true },
    { tenantId: 'tenant-a', sessionId: 'duplicate-is-rejected' },
    { tenantId: 'tenant-b', wsUrl: 'ws://insecure.example.test' },
    { tenantId: 'tenant-c', wsUrl: 'wss://example.test/live', visibility: 'private' },
    { tenantId: 'tenant-d', sessionId: 'disabled', enabled: false },
  ]);
  assert.deepEqual(configs.map((config) => config.tenantId), ['tenant-a', 'tenant-c']);
  assert.equal(configs[1]?.visibility, 'private');
});

test('featured OBS data is public only when an explicit tenant is present', async () => {
  const allowed = await middleware(new NextRequest(
    'https://streamweaver-new.fly.dev/api/shared-chat/featured?tenant=tenant-overlay',
  ));
  assert.equal(allowed.status, 200);
  assert.equal(allowed.headers.get('x-middleware-next'), '1');

  const denied = await middleware(new NextRequest(
    'https://streamweaver-new.fly.dev/api/shared-chat/featured',
  ));
  assert.equal(denied.status, 401);
});
