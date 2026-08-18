import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('private Discord DMs resolve only to the verified Discord identity and never fall back to the owner tenant', async () => {
  const persistRoot = await mkdtemp(path.join(os.tmpdir(), 'streamweaver-private-dm-lock-'));
  const previous = {
    PERSIST_ROOT: process.env.PERSIST_ROOT,
    DISCORD_BOT_TOKEN: process.env.DISCORD_BOT_TOKEN,
    SPMT_BASE_URL: process.env.SPMT_BASE_URL,
    ADMIN_TWITCH_ID: process.env.ADMIN_TWITCH_ID,
  };
  const originalFetch = global.fetch;

  process.env.PERSIST_ROOT = persistRoot;
  process.env.DISCORD_BOT_TOKEN = 'test-discord-bot-token';
  process.env.SPMT_BASE_URL = 'https://spmt.example';
  process.env.ADMIN_TWITCH_ID = 'owner-tenant';

  const discordA = '111111111111111111';
  const discordB = '222222222222222222';
  const ownerDiscord = '333333333333333333';
  const channelA = '444444444444444444';
  const channelB = '555555555555555555';
  const messageA = '666666666666666666';
  const messageB = '777777777777777777';

  try {
    const tenant = await import('../src/lib/tenant');
    const discordConfig = await import('../src/lib/discord-config');
    const privateDm = await import('../src/services/private-discord-tenant');

    // An owner tenant exists, reproducing the exact condition that used to make
    // an unknown DM dangerous: the old resolver could fall back to this tenant.
    await tenant.bootstrapTenant('owner-tenant', 'mtman1987');
    await discordConfig.updateDiscordConfig({
      discordUserId: ownerDiscord,
      discordUsername: 'mtman1987',
      dmEnabled: true,
    } as any, 'owner-tenant');

    global.fetch = async (input: URL | RequestInfo) => {
      const url = String(input instanceof Request ? input.url : input);

      if (url.includes(`/channels/${channelA}/messages/${messageA}`)) {
        return new Response(JSON.stringify({ author: { id: discordA, bot: false } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.includes(`/channels/${channelB}/messages/${messageB}`)) {
        return new Response(JSON.stringify({ author: { id: discordB, bot: false } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.startsWith('https://spmt.example/api/user/lookup')) {
        const parsed = new URL(url);
        if (parsed.searchParams.get('discord_id') === discordA) {
          return new Response(JSON.stringify({
            id: 'spmt-saltybear',
            username: 'saltybear',
            discord_id: discordA,
            discord_username: 'SaltyBear',
          }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        return new Response(JSON.stringify({ error: 'not found' }), {
          status: 404,
          headers: { 'content-type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({ error: 'unexpected request' }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      });
    };

    const resolvedA = await privateDm.resolvePrivateDiscordTenant({
      discordUserId: discordA,
      discordUsername: 'SaltyBear',
      channelId: channelA,
      messageId: messageA,
    });
    assert.deepEqual(resolvedA, { tenantId: 'spmt-saltybear', source: 'spmt-discord' });

    const configA = await discordConfig.readDiscordConfig('spmt-saltybear');
    assert.equal(configA.discordUserId, discordA);
    assert.equal(configA.dmChannelId, channelA);

    // Unknown Discord users must not inherit the owner tenant just because it exists.
    const unknown = await privateDm.resolvePrivateDiscordTenant({
      discordUserId: discordB,
      discordUsername: 'SomeoneElse',
      channelId: channelB,
      messageId: messageB,
    });
    assert.equal(unknown, undefined);

    const ownerConfigAfterUnknown = await discordConfig.readDiscordConfig('owner-tenant');
    assert.equal(ownerConfigAfterUnknown.discordUserId, ownerDiscord);
    assert.notEqual(ownerConfigAfterUnknown.dmChannelId, channelB);

    // A forwarded/spoofed author ID is also rejected: Discord itself must confirm
    // the immutable author on the exact DM message before tenant history is touched.
    const forged = await privateDm.resolvePrivateDiscordTenant({
      discordUserId: discordA,
      discordUsername: 'SaltyBear',
      channelId: channelB,
      messageId: messageB,
    });
    assert.equal(forged, undefined);
  } finally {
    global.fetch = originalFetch;
    if (previous.PERSIST_ROOT == null) delete process.env.PERSIST_ROOT; else process.env.PERSIST_ROOT = previous.PERSIST_ROOT;
    if (previous.DISCORD_BOT_TOKEN == null) delete process.env.DISCORD_BOT_TOKEN; else process.env.DISCORD_BOT_TOKEN = previous.DISCORD_BOT_TOKEN;
    if (previous.SPMT_BASE_URL == null) delete process.env.SPMT_BASE_URL; else process.env.SPMT_BASE_URL = previous.SPMT_BASE_URL;
    if (previous.ADMIN_TWITCH_ID == null) delete process.env.ADMIN_TWITCH_ID; else process.env.ADMIN_TWITCH_ID = previous.ADMIN_TWITCH_ID;
    await rm(persistRoot, { recursive: true, force: true });
  }
});

test('private data entry points and production build install the privacy lock', async () => {
  const [pkgRaw, privateRoute, ltmRoute, patchScript] = await Promise.all([
    readFile(path.join(process.cwd(), 'package.json'), 'utf8'),
    readFile(path.join(process.cwd(), 'src/app/api/private-chat/route.ts'), 'utf8'),
    readFile(path.join(process.cwd(), 'src/app/api/private-ltm/condense/route.ts'), 'utf8'),
    readFile(path.join(process.cwd(), 'scripts/patch-private-dm-privacy.mjs'), 'utf8'),
  ]);
  const pkg = JSON.parse(pkgRaw);

  assert.match(pkg.scripts.prebuild, /patch-private-dm-privacy\.mjs/);
  assert.match(pkg.scripts['prebuild:simple'], /patch-private-dm-privacy\.mjs/);
  assert.match(pkg.scripts.dev, /patch-private-dm-privacy\.mjs/);

  assert.match(privateRoute, /if \(!tenantId\) return apiError\('Unauthorized'/);
  assert.match(privateRoute, /getPrivateChatFilePath\(tenantId\)/);
  assert.match(ltmRoute, /hasInternalServiceAccess/);
  assert.match(ltmRoute, /TENANT_MISMATCH/);

  assert.match(patchScript, /resolvePrivateDiscordTenant/);
  assert.match(patchScript, /private-discord-identity-not-verified/);
  assert.match(patchScript, /unsafe owner\/channel fallback still present/);
});
