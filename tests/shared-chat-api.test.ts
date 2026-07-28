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
