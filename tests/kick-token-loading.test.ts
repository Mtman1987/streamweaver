import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('shared Kick bot token keeps tenant broadcaster channel metadata', async () => {
  const persistRoot = await mkdtemp(path.join(os.tmpdir(), 'streamweaver-kick-token-'));
  process.env.PERSIST_ROOT = persistRoot;

  try {
    const tenantTokensDir = path.join(persistRoot, 'tenants', 'tenant-a', 'tokens');
    const globalDir = path.join(persistRoot, 'global');
    await mkdir(tenantTokensDir, { recursive: true });
    await mkdir(globalDir, { recursive: true });
    await writeFile(path.join(tenantTokensDir, 'kick-tokens.json'), JSON.stringify({
      broadcasterUsername: 'ladyheidi',
      broadcasterChannelId: '1795845',
      broadcasterChatroomId: '1788418',
    }));
    await writeFile(path.join(globalDir, 'kick-bot-tokens.json'), JSON.stringify({
      accessToken: 'shared-access-token',
      refreshToken: 'shared-refresh-token',
      tokenExpiry: Date.now() + 60_000,
      username: 'streamweaverbot',
    }));

    const { KickService } = await import('../src/services/kick');
    const tokens = await new KickService().loadTokens('tenant-a');

    assert.equal(tokens?.username, 'streamweaverbot');
    assert.equal(tokens?.channelId, '1795845');
    assert.equal(tokens?.chatroomId, '1788418');
  } finally {
    await rm(persistRoot, { recursive: true, force: true });
  }
});
