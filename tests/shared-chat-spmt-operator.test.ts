import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { NextRequest } from 'next/server';

import { normalizeTwitchSharedChatEvent } from '../src/services/shared-chat-normalizers';
import { GET, POST } from '../src/app/api/shared-chat/spmt-operator/route';

function serviceRequest(method: 'GET' | 'POST', tenantId: string, body?: unknown, key = 'operator-test-key') {
  return new NextRequest('https://streamweaver.test/api/shared-chat/spmt-operator', {
    method,
    headers: {
      'x-spmt-key': key,
      'x-spmt-tenant-id': tenantId,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

test('SPMT operator bridge is service-authenticated, tenant-isolated, and returns named outputs', async () => {
  const persistRoot = await mkdtemp(path.join(os.tmpdir(), 'streamweaver-spmt-operator-'));
  const priorRoot = process.env.PERSIST_ROOT;
  const priorKey = process.env.SPMT_SYSTEM_KEY;
  process.env.PERSIST_ROOT = persistRoot;
  process.env.SPMT_SYSTEM_KEY = 'operator-test-key';

  try {
    const denied = await GET(serviceRequest('GET', 'tenant-a', undefined, 'wrong-key'));
    assert.equal(denied.status, 401);

    const { recordSharedChatEvent } = await import('../src/services/shared-chat-ingestion');
    const event = normalizeTwitchSharedChatEvent({
      tenantId: 'tenant-a',
      channel: '#alpha',
      message: 'stage me',
      tags: { id: 'operator-message-1', username: 'viewer-a' },
    });
    await recordSharedChatEvent(event);

    const queued = await POST(serviceRequest('POST', 'tenant-a', { action: 'queue', eventId: event.eventId }));
    assert.equal(queued.status, 200);
    assert.equal((await queued.json()).state.queuedEventIds[0], event.eventId);

    const tenantA = await (await GET(serviceRequest('GET', 'tenant-a'))).json();
    const tenantB = await (await GET(serviceRequest('GET', 'tenant-b'))).json();
    assert.equal(tenantA.version, 'commlink-operator.v1');
    assert.equal(tenantA.outputs[0].id, 'featured-chat');
    assert.deepEqual(tenantA.state.queuedEventIds, [event.eventId]);
    assert.deepEqual(tenantB.state.queuedEventIds, []);
  } finally {
    if (priorRoot == null) delete process.env.PERSIST_ROOT; else process.env.PERSIST_ROOT = priorRoot;
    if (priorKey == null) delete process.env.SPMT_SYSTEM_KEY; else process.env.SPMT_SYSTEM_KEY = priorKey;
    await rm(persistRoot, { recursive: true, force: true });
  }
});
