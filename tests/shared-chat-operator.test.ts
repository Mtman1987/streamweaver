import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { NextRequest } from 'next/server';

import { serializeSessionCookie } from '../src/lib/session-cookie';
import { normalizeTwitchSharedChatEvent } from '../src/services/shared-chat-normalizers';
import { GET, POST } from '../src/app/api/shared-chat/operator/route';

function request(url: string, tenantId: string, body?: unknown): NextRequest {
  const cookie = serializeSessionCookie({ id: tenantId, username: 'owner' });
  return new NextRequest(url, {
    method: body ? 'POST' : 'GET',
    headers: {
      cookie: `streamweaver-session=${cookie}`,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

test('shared chat operator state persists show controls per tenant', async () => {
  const persistRoot = await mkdtemp(path.join(os.tmpdir(), 'streamweaver-shared-chat-operator-'));
  const priorRoot = process.env.PERSIST_ROOT;
  const priorSecret = process.env.STREAMWEAVER_SESSION_SECRET;
  process.env.PERSIST_ROOT = persistRoot;
  process.env.STREAMWEAVER_SESSION_SECRET = 'test-session-secret-that-is-not-used-in-production';

  try {
    const { recordSharedChatEvent } = await import('../src/services/shared-chat-ingestion');
    const first = normalizeTwitchSharedChatEvent({
      tenantId: 'tenant-operator-a', channel: '#alpha', message: 'feature me',
      tags: { id: 'msg-1', username: 'viewer-a' },
    });
    const second = normalizeTwitchSharedChatEvent({
      tenantId: 'tenant-operator-a', channel: '#alpha', message: 'next up',
      tags: { id: 'msg-2', username: 'viewer-b' },
    });
    await recordSharedChatEvent(first);
    await recordSharedChatEvent(second);

    await POST(request('https://streamweaver.test/api/shared-chat/operator', 'tenant-operator-a', { action: 'pin', eventId: first.eventId }));
    await POST(request('https://streamweaver.test/api/shared-chat/operator', 'tenant-operator-a', { action: 'feature', eventId: first.eventId }));
    await POST(request('https://streamweaver.test/api/shared-chat/operator', 'tenant-operator-a', { action: 'queue', eventId: second.eventId }));
    await POST(request('https://streamweaver.test/api/shared-chat/operator', 'tenant-operator-a', { action: 'next' }));

    const response = await GET(request('https://streamweaver.test/api/shared-chat/operator', 'tenant-operator-a'));
    const body = await response.json();
    assert.deepEqual(body.state.pinnedEventIds, [first.eventId]);
    assert.equal(body.state.featuredEventId, second.eventId);
    assert.deepEqual(body.state.queuedEventIds, []);

    const tenantB = await (await GET(request('https://streamweaver.test/api/shared-chat/operator', 'tenant-operator-b'))).json();
    assert.equal(tenantB.state.featuredEventId, null);
    assert.deepEqual(tenantB.state.pinnedEventIds, []);
  } finally {
    if (priorRoot == null) delete process.env.PERSIST_ROOT; else process.env.PERSIST_ROOT = priorRoot;
    if (priorSecret == null) delete process.env.STREAMWEAVER_SESSION_SECRET; else process.env.STREAMWEAVER_SESSION_SECRET = priorSecret;
    await rm(persistRoot, { recursive: true, force: true });
  }
});
