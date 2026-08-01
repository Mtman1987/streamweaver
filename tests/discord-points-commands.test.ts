import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

type SentDiscordMessage = { channelId: string; content: string };

async function withDispatcher(
  run: (ctx: {
    handleDiscordMessage: (msg: any, tenantId?: string, options?: any) => Promise<{ commandHandled: boolean }>;
    sent: SentDiscordMessage[];
    dshCalls: string[];
  }) => Promise<void>,
) {
  const persistRoot = await mkdtemp(path.join(os.tmpdir(), 'streamweaver-points-'));
  process.env.PERSIST_ROOT = persistRoot;
  process.env.DISCORD_BOT_TOKEN = 'test-bot-token';
  process.env.BOT_SECRET_KEY = 'test-secret';
  process.env.DISCORD_STREAM_HUB_URL = 'https://dsh.test';

  const tokensDir = path.join(persistRoot, 'tenants', 'tenant-a', 'tokens');
  await mkdir(tokensDir, { recursive: true });
  await writeFile(path.join(tokensDir, 'user-config.json'), JSON.stringify({ AI_BOT_NAME: 'Athena' }));

  const sent: SentDiscordMessage[] = [];
  const dshCalls: string[] = [];
  const realFetch = globalThis.fetch;

  globalThis.fetch = (async (input: any, init: any = {}) => {
    const url = String(input?.url || input);
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

    if (url.includes('/api/points/balance')) {
      dshCalls.push('balance');
      return json({ points: 13691, rank: 14, username: 'mtman1987', displayName: 'mtman1987' });
    }
    if (url.includes('/api/points/leaderboard')) {
      dshCalls.push('leaderboard');
      return json([
        { userProfileId: '1', points: 20, lastEventMetadata: { displayName: 'First' } },
        { userProfileId: '2', points: 10, lastEventMetadata: { displayName: 'Second' } },
      ]);
    }
    if (url.includes('/api/admin/access')) {
      dshCalls.push('admin-access');
      return json({ isAdmin: false, isMod: false, isOwner: false });
    }
    if (/discord\.com\/api\/v10\/channels\/\d+\/webhooks/.test(url)) {
      return json({ id: 'webhook-id', token: 'webhook-token' });
    }
    if (url.includes('discord.com/api/webhooks/')) {
      const body = JSON.parse(String(init.body || '{}'));
      sent.push({ channelId: '1463633163673927732', content: String(body.content || '') });
      return json({ id: 'webhook-message' });
    }
    if (url.includes('discord.com/api')) {
      const channelId = url.match(/channels\/(\d+)/)?.[1] || '';
      const body = JSON.parse(String(init.body || '{}'));
      sent.push({ channelId, content: String(body.content || '') });
      return json({ id: `${Date.now()}` });
    }
    return json({});
  }) as typeof fetch;

  try {
    const { handleDiscordMessage } = await import('../src/services/chat-dispatcher');
    await run({ handleDiscordMessage, sent, dshCalls });
  } finally {
    globalThis.fetch = realFetch;
    await rm(persistRoot, { recursive: true, force: true });
  }
}

const baseMessage = (content: string) => ({
  content,
  channelId: '1463633163673927732',
  guildId: '1240832965865635881',
  messageId: `msg-${Math.random().toString(36).slice(2)}`,
  author: { id: '999999999999999999', username: 'viewer', bot: false },
});

test('!points answers in Discord without an admin lookup', async () => {
  await withDispatcher(async ({ handleDiscordMessage, sent, dshCalls }) => {
    const result = await handleDiscordMessage(baseMessage('!points'), 'tenant-a', { replyMode: 'bot' });

    assert.equal(result.commandHandled, true);
    assert.equal(dshCalls.includes('balance'), true);
    assert.equal(dshCalls.includes('admin-access'), false);
    assert.match(sent.at(-1)?.content || '', /13,691 points/);
  });
});

test('!pleader answers with the Discord points leaderboard', async () => {
  await withDispatcher(async ({ handleDiscordMessage, sent, dshCalls }) => {
    const result = await handleDiscordMessage(baseMessage('!pleader'), 'tenant-a', { replyMode: 'bot' });

    assert.equal(result.commandHandled, true);
    assert.equal(dshCalls.includes('leaderboard'), true);
    assert.match(sent.at(-1)?.content || '', /#1 First 20/);
  });
});
