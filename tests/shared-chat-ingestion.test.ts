import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { normalizeTwitchSharedChatEvent } from '../src/services/shared-chat-normalizers';

test('shared chat ingestion stores bounded replay history and dedupes events', async () => {
  const persistRoot = await mkdtemp(path.join(os.tmpdir(), 'streamweaver-shared-chat-'));
  const priorRoot = process.env.PERSIST_ROOT;
  process.env.PERSIST_ROOT = persistRoot;

  try {
    const { recordSharedChatEvent, readSharedChatReplay } = await import('../src/services/shared-chat-ingestion');
    const first = normalizeTwitchSharedChatEvent({
      tenantId: 'tenant-a',
      channel: '#space_mountain',
      message: 'first',
      tags: { id: 'msg-1', username: 'viewer', 'display-name': 'Viewer' },
    });
    const second = normalizeTwitchSharedChatEvent({
      tenantId: 'tenant-a',
      channel: '#space_mountain',
      message: 'second',
      tags: { id: 'msg-2', username: 'viewer', 'display-name': 'Viewer' },
    });

    await recordSharedChatEvent(first, { maxReplayEvents: 2 });
    await recordSharedChatEvent(first, { maxReplayEvents: 2 });
    await recordSharedChatEvent(second, { maxReplayEvents: 2 });

    const replay = await readSharedChatReplay('tenant-a');
    assert.equal(replay.length, 2);
    assert.deepEqual(replay.map((event) => event.upstreamId), ['msg-1', 'msg-2']);

    const raw = JSON.parse(await readFile(path.join(persistRoot, 'tenants', 'tenant-a', 'data', 'shared-chat', 'replay.json'), 'utf-8'));
    assert.equal(raw.length, 2);
  } finally {
    if (priorRoot == null) delete process.env.PERSIST_ROOT; else process.env.PERSIST_ROOT = priorRoot;
    await rm(persistRoot, { recursive: true, force: true });
  }
});

test('shared chat ingestion stores bounded dead letters per tenant', async () => {
  const persistRoot = await mkdtemp(path.join(os.tmpdir(), 'streamweaver-shared-chat-dl-'));
  const priorRoot = process.env.PERSIST_ROOT;
  process.env.PERSIST_ROOT = persistRoot;

  try {
    const { readSharedChatDeadLetters, recordSharedChatDeadLetter } = await import('../src/services/shared-chat-ingestion');
    await recordSharedChatDeadLetter({ tenantId: 'tenant-a', source: 'discord', reason: 'bad payload 1', payload: { a: 1 } }, { maxDeadLetters: 1 });
    await recordSharedChatDeadLetter({ tenantId: 'tenant-a', source: 'discord', reason: 'bad payload 2', payload: { b: 2 } }, { maxDeadLetters: 1 });

    const deadLetters = await readSharedChatDeadLetters('tenant-a');
    assert.equal(deadLetters.length, 1);
    assert.equal(deadLetters[0]?.reason, 'bad payload 2');
  } finally {
    if (priorRoot == null) delete process.env.PERSIST_ROOT; else process.env.PERSIST_ROOT = priorRoot;
    await rm(persistRoot, { recursive: true, force: true });
  }
});
