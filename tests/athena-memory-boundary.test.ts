import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('public Athena cannot retrieve private memory while private Athena can retrieve both', async () => {
  const persistRoot = await mkdtemp(path.join(os.tmpdir(), 'streamweaver-athena-memory-'));
  process.env.PERSIST_ROOT = persistRoot;

  try {
    const {
      appendAthenaMemory,
      buildAthenaTurnRecord,
      retrieveAthenaMemory,
    } = await import('../src/services/athena-memory');

    const tenantId = 'athena-memory-test';
    await appendAthenaMemory([
      buildAthenaTurnRecord({
        tenantId,
        visibility: 'public',
        conversationId: 'public-thread',
        role: 'user',
        content: 'The public launch color is blue.',
        actor: { username: 'captain' },
        location: { app: 'streamweaver', surface: 'twitch-chat', channelName: 'public-chat' },
      }),
      buildAthenaTurnRecord({
        tenantId,
        visibility: 'private',
        conversationId: 'private-thread',
        role: 'user',
        content: 'The private launch code is NOVA-SEVEN.',
        actor: { username: 'captain' },
        location: { app: 'streamweaver', surface: 'discord-dm', channelId: 'private-dm' },
      }),
    ]);

    const publicHits = await retrieveAthenaMemory({
      tenantId,
      visibility: 'public',
      conversationId: 'new-public-thread',
      surface: 'twitch-chat',
      message: 'What are the launch color and launch code?',
      limit: 20,
    });
    const privateHits = await retrieveAthenaMemory({
      tenantId,
      visibility: 'private',
      conversationId: 'new-private-thread',
      surface: 'discord-dm',
      message: 'What are the launch color and launch code?',
      limit: 20,
    });

    assert.ok(publicHits.some((hit) => hit.content.includes('public launch color')));
    assert.equal(publicHits.some((hit) => hit.content.includes('NOVA-SEVEN')), false);
    assert.ok(privateHits.some((hit) => hit.content.includes('public launch color')));
    assert.ok(privateHits.some((hit) => hit.content.includes('NOVA-SEVEN')));
  } finally {
    await rm(persistRoot, { recursive: true, force: true });
  }
});

test('legacy Commander memory is available only in a private owner or Commander context', async () => {
  const persistRoot = await mkdtemp(path.join(os.tmpdir(), 'streamweaver-athena-commander-'));
  process.env.PERSIST_ROOT = persistRoot;

  try {
    const { appendCommanderMemory } = await import('../src/lib/commander-memory');
    const { retrieveAthenaMemory } = await import('../src/services/athena-memory');
    await appendCommanderMemory({
      tenantId: 'another-stream',
      botName: 'Athena',
      message: 'The private cross-stream phrase is ORBIT-CROWN.',
      response: 'I will remember that privately.',
      timestamp: new Date().toISOString(),
    });

    const strangerHits = await retrieveAthenaMemory({
      tenantId: 'athena-owner-gate-test',
      visibility: 'private',
      conversationId: 'stranger-private',
      surface: 'discord-dm',
      actorUsername: 'some-viewer',
      message: 'What is the private cross-stream phrase?',
      limit: 20,
    });
    const commanderHits = await retrieveAthenaMemory({
      tenantId: 'athena-owner-gate-test',
      visibility: 'private',
      conversationId: 'commander-private',
      surface: 'rotator-workbench',
      actorUsername: 'mtman1987',
      actorIsOwner: true,
      message: 'What is the private cross-stream phrase?',
      limit: 20,
    });

    assert.equal(strangerHits.some((hit) => hit.content.includes('ORBIT-CROWN')), false);
    assert.ok(commanderHits.some((hit) => hit.content.includes('ORBIT-CROWN')));
  } finally {
    await rm(persistRoot, { recursive: true, force: true });
  }
});
