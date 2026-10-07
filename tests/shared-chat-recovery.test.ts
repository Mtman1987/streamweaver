import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { normalizeTwitchSharedChatEvent } from '../src/services/shared-chat-normalizers';

test('replay survives malformed storage and concurrent writes without losing events', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'replay-recovery-'));
  const previous = process.env.PERSIST_ROOT;
  process.env.PERSIST_ROOT = root;
  try {
    const { readSharedChatReplay, recordSharedChatEvent, recordSharedChatDeadLetter, readSharedChatDeadLetters } = await import('../src/services/shared-chat-ingestion');
    const folder = path.join(root, 'tenants', 'repair-test', 'data', 'shared-chat');
    await mkdir(folder, { recursive: true });
    const malformed = '[] trailing garbage';
    await writeFile(path.join(folder, 'replay.json'), malformed);
    assert.deepEqual(await readSharedChatReplay('repair-test'), []);
    const backups = (await readdir(folder)).filter(name => name.includes('.corrupt-'));
    assert.equal(backups.length, 1);
    assert.equal(await readFile(path.join(folder, backups[0]), 'utf8'), malformed);
    await readSharedChatReplay('repair-test');
    assert.equal((await readdir(folder)).filter(name => name.includes('.corrupt-')).length, 1);

    const events = Array.from({ length: 40 }, (_, i) => normalizeTwitchSharedChatEvent({
      tenantId: 'repair-test', channel: '#test', message: 'event ' + i,
      tags: { id: 'msg-' + i, username: 'viewer', 'display-name': 'Viewer' },
    }));
    await Promise.all(events.map(event => recordSharedChatEvent(event)));
    let replay = await readSharedChatReplay('repair-test');
    assert.equal(replay.length, 40);
    assert.equal(new Set(replay.map(event => event.upstreamId)).size, 40);
    await Promise.all(events.map(event => recordSharedChatEvent(event)));
    replay = await readSharedChatReplay('repair-test');
    assert.equal(replay.length, 40);
    assert.equal((await readdir(folder)).filter(name => name.endsWith('.tmp') || name.endsWith('.lock')).length, 0);

    await Promise.all(Array.from({length: 30}, (_, i) => recordSharedChatDeadLetter({
      tenantId: 'repair-test', source: 'discord', reason: 'bad ' + i, payload: { index: i },
    })));
    assert.equal((await readSharedChatDeadLetters('repair-test')).length, 30);
  } finally {
    if (previous === undefined) delete process.env.PERSIST_ROOT; else process.env.PERSIST_ROOT = previous;
    await rm(root, { recursive: true, force: true });
  }
});
