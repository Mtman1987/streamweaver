import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

type SettleCall = { url: string; body: any };

async function withSettleCapture(run: (calls: SettleCall[]) => Promise<void>) {
  process.env.PERSIST_ROOT = await mkdtemp(path.join(os.tmpdir(), 'streamweaver-gamble-'));
  process.env.BOT_SECRET_KEY = 'test-secret';
  process.env.DISCORD_STREAM_HUB_URL = 'https://dsh.test';

  const calls: SettleCall[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: any, init: any = {}) => {
    const url = String(input?.url || input);
    calls.push({ url, body: init.body ? JSON.parse(String(init.body)) : null });
    return new Response(
      JSON.stringify({ points: 1_000, currentPoints: 1_000, lifetimePoints: 5_000, rank: 4, source: 'spmt' }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }) as typeof fetch;

  try {
    await run(calls);
  } finally {
    globalThis.fetch = realFetch;
  }
}

test('a Discord win settles stake and payout against the SPMT wallet', async () => {
  await withSettleCapture(async (calls) => {
    const { runWithChatOutputContext } = await import('../src/services/chat-output-context');
    const { settleWager } = await import('../src/services/points');

    const wallet = await runWithChatOutputContext(
      {
        platform: 'discord',
        channelId: 'channel-1',
        guildId: 'guild-1',
        userId: 'discord-user-1',
        username: 'viewer',
        messageContent: '!gamble 500',
      },
      () => settleWager('viewer', { wager: 500, payout: 750, newTotal: 1_250, eventType: 'gamble' }),
    );

    const settle = calls.find((call) => call.url.includes('/api/points/gamble-settle'));
    assert.ok(settle, 'expected a gamble settlement call');
    assert.equal(settle.body.wager, 500);
    assert.equal(settle.body.payout, 750);
    assert.equal(settle.body.userId, 'discord-user-1');
    assert.ok(settle.body.idempotencyKey, 'settlement must be idempotent');
    // The wallet answers, not the handler's own newTotal.
    assert.equal(wallet.currentPoints, 1_000);
    assert.equal(wallet.lifetimePoints, 5_000);
  });
});

test('a Discord loss settles with a zero payout instead of writing a new total', async () => {
  await withSettleCapture(async (calls) => {
    const { runWithChatOutputContext } = await import('../src/services/chat-output-context');
    const { settleWager } = await import('../src/services/points');

    await runWithChatOutputContext(
      {
        platform: 'discord',
        channelId: 'channel-1',
        guildId: 'guild-1',
        userId: 'discord-user-1',
        username: 'viewer',
        messageContent: '!roll 500',
      },
      () => settleWager('viewer', { wager: 500, payout: 0, newTotal: 0, eventType: 'roll' }),
    );

    assert.equal(calls.filter((call) => call.url.includes('/api/points/set')).length, 0);
    const settle = calls.find((call) => call.url.includes('/api/points/gamble-settle'));
    assert.ok(settle);
    assert.equal(settle.body.payout, 0);
    assert.equal(settle.body.eventType, 'roll');
  });
});
