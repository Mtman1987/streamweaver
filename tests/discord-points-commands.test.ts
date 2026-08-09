import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

type SentDiscordMessage = { channelId: string; content: string; embeds: any[] };

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

    if (url.includes('/api/points/tenant-balances')) {
      dshCalls.push('tenant-balances');
      return json({
        tenants: [
          {
            tenantId: '1240832965865635881',
            serverId: '1240832965865635881',
            tenantName: 'Mtman1987',
            currentPoints: 9_200,
            lifetimePoints: 13_691,
            rank: 3,
          },
          {
            tenantId: 'other-community',
            serverId: 'other-community',
            tenantName: 'Guest Streamer',
            currentPoints: 300,
            lifetimePoints: 500,
            rank: 8,
          },
        ],
      });
    }
    if (url.includes('/api/points/balance')) {
      dshCalls.push('balance');
      return json({
        points: 9_200,
        currentPoints: 9_200,
        lifetimePoints: 13_691,
        rank: 3,
        source: 'spmt',
        username: 'mtman1987',
        displayName: 'mtman1987',
      });
    }
    if (url.includes('/api/leaderboard/render')) {
      dshCalls.push('leaderboard-render');
      return json({
        title: '🏆 Space Mountain Points Leaderboard',
        imageUrl: 'https://dsh.test/leaderboard.png',
        scope: 'Space Mountain',
        updatedAt: '2026-08-02T00:00:00.000Z',
        rankButtonCustomId: 'check_rank_test',
      });
    }
    if (url.includes('/api/points/leaderboard')) {
      dshCalls.push('leaderboard');
      return json([
        { userProfileId: 'spmt-1', rank: 1, points: 20000, currentPoints: 18000, lifetimePoints: 20000, lastEventMetadata: { displayName: 'First' } },
        { userProfileId: 'spmt-2', rank: 2, points: 14000, currentPoints: 500, lifetimePoints: 14000, lastEventMetadata: { displayName: 'Second' } },
        { userProfileId: 'spmt-3', rank: 3, points: 13691, currentPoints: 9200, lifetimePoints: 13691, lastEventMetadata: { displayName: 'viewer' } },
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
      sent.push({ channelId: '1463633163673927732', content: String(body.content || ''), embeds: body.embeds || [] });
      return json({ id: 'webhook-message' });
    }
    if (url.includes('discord.com/api')) {
      const channelId = url.match(/channels\/(\d+)/)?.[1] || '';
      const body = JSON.parse(String(init.body || '{}'));
      sent.push({ channelId, content: String(body.content || ''), embeds: body.embeds || [] });
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
    assert.equal(dshCalls.includes('tenant-balances'), true);
    assert.equal(dshCalls.includes('admin-access'), false);
    const embed = lastEmbed(sent);
    assert.ok(embed, 'bot-token mode must preserve the structured embed');
    assert.match(String(embed.description), /Mtman1987\*\* — 9,200 current/);
  });
});

const lastEmbed = (sent: SentDiscordMessage[]) =>
  [...sent].reverse().find((entry) => entry.embeds?.length)?.embeds[0];

test('!points shows canonical SPMT XP before separate tenant balances', async () => {
  await withDispatcher(async ({ handleDiscordMessage, sent, dshCalls }) => {
    await handleDiscordMessage(baseMessage('!points'), 'tenant-a');

    const embed = lastEmbed(sent);
    assert.ok(embed, 'expected an embed reply');
    assert.match(String(embed.title), /viewer/);
    assert.equal(dshCalls.includes('balance'), true);
    assert.equal(dshCalls.includes('tenant-balances'), true);
    const fields = Object.fromEntries((embed.fields || []).map((f: any) => [f.name, f.value]));
    assert.equal(fields['SPMT XP'], '13,691');
    assert.equal(fields['Global rank'], '#3');
    assert.equal(fields['Tenant balances'], '2');
    assert.equal(fields['Combined current'], undefined);
    assert.match(String(embed.description), /Mtman1987\*\* — 9,200 current/);
    assert.match(String(embed.description), /Guest Streamer\*\* — 300 current/);
  });
});

test('!pints is an alias for the structured !points response', async () => {
  await withDispatcher(async ({ handleDiscordMessage, sent, dshCalls }) => {
    const result = await handleDiscordMessage(baseMessage('!pints'), 'tenant-a');

    assert.equal(result.commandHandled, true);
    assert.equal(dshCalls.includes('balance'), true);
    assert.equal(dshCalls.includes('tenant-balances'), true);
    assert.equal(lastEmbed(sent)?.fields?.[0]?.name, 'SPMT XP');
  });
});

test('!pleader posts the rendered Discord Stream Hub points leaderboard image', async () => {
  await withDispatcher(async ({ handleDiscordMessage, sent, dshCalls }) => {
    const result = await handleDiscordMessage(baseMessage('!pleader'), 'tenant-a');

    assert.equal(result.commandHandled, true);
    assert.equal(dshCalls.includes('leaderboard-render'), true);
    const embed = lastEmbed(sent);
    assert.ok(embed, 'expected a rendered leaderboard embed');
    assert.equal(embed.image?.url, 'https://dsh.test/leaderboard.png');
    assert.match(String(embed.description), /Global SPMT XP/);
  });
});

test('embed footer uses the requester avatar and falls back to the SPMT logo thumbnail', async () => {
  await withDispatcher(async ({ handleDiscordMessage, sent }) => {
    await handleDiscordMessage({
      ...baseMessage('!points'),
      author: { id: '999999999999999999', username: 'viewer', bot: false, avatar: 'abc123' },
    }, 'tenant-a');

    const embed = lastEmbed(sent);
    assert.ok(embed, 'expected an embed reply');
    assert.equal(embed.footer.icon_url, 'https://cdn.discordapp.com/avatars/999999999999999999/abc123.png?size=128');
    assert.match(String(embed.thumbnail.url), /space-logo-main\.png$/);
  });
});
