import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { NextRequest } from 'next/server';

import { POST as postSocialStream } from '../src/app/api/integrations/social-stream/route';

test('Social Stream bridge stores a normalized tenant replay event', async () => {
  const persistRoot = await mkdtemp(path.join(os.tmpdir(), 'streamweaver-social-stream-api-'));
  const priorRoot = process.env.PERSIST_ROOT;
  const priorToken = process.env.SOCIAL_STREAM_BRIDGE_TOKEN;
  process.env.PERSIST_ROOT = persistRoot;
  process.env.SOCIAL_STREAM_BRIDGE_TOKEN = 'test-bridge-token';

  try {
    const response = await postSocialStream(new NextRequest(
      'https://streamweaver-new.fly.dev/api/integrations/social-stream',
      {
        method: 'POST',
        headers: {
          authorization: 'Bearer test-bridge-token',
          'content-type': 'application/json',
          'x-streamweaver-tenant-id': 'tenant-eevee',
        },
        body: JSON.stringify({
          id: 'ssn-1',
          type: 'youtube',
          chatname: 'Viewer',
          chatmessage: 'What is Vocaloid?',
          channelId: 'live-1',
        }),
      },
    ));
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.tenantId, 'tenant-eevee');
    assert.equal(body.replayStored, true);

    const { readSharedChatReplay } = await import('../src/services/shared-chat-ingestion');
    const replay = await readSharedChatReplay('tenant-eevee');
    assert.equal(replay.length, 1);
    assert.equal(replay[0]?.platform, 'social-stream');
    assert.equal(replay[0]?.meta.rawProvider, 'youtube');
  } finally {
    if (priorRoot == null) delete process.env.PERSIST_ROOT; else process.env.PERSIST_ROOT = priorRoot;
    if (priorToken == null) delete process.env.SOCIAL_STREAM_BRIDGE_TOKEN; else process.env.SOCIAL_STREAM_BRIDGE_TOKEN = priorToken;
    await rm(persistRoot, { recursive: true, force: true });
  }
});
