const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
function load(file, req = () => ({}), env = {}) {
  const m = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    module: m, exports: m.exports, require: req, process: { env }, Date, Set, Map,
    URL, URLSearchParams, AbortSignal, fetch: () => { throw Error('Unexpected network request'); }, console: { info() {} },
  });
  return m.exports;
}
const { createStellaCheckinShoutout, formatCheckinShoutoutReply, formatCheckinChatShoutoutReply } = load('src/services/checkin-shoutout.ts');
const { isConfirmedLoungeStellaShoutout } = load('src/services/lounge-stella-shoutout-command.ts');

test('only confirmed Stella !so receipts in the Lounge may pass the bot-loop guards', () => {
  const receipt = { tenantId: 'spacemountainlive', channel: '#spacemountainlive', tags: { username: 'stellabot87', id: 'twitch-message-id' }, message: '!so player_channel' };
  assert.equal(isConfirmedLoungeStellaShoutout(receipt), true);
  for (const change of [
    { tenantId: 'another-tenant' }, { channel: '#another-channel' },
    { tags: { username: 'another_bot', id: 'twitch-message-id' } },
    { tags: { username: 'stellabot87' } },
    { message: '!addpoints player_channel 100' }, { message: 'Hello!' },
    { message: '!so player_channel extra' }, { message: '!so' },
  ]) assert.equal(isConfirmedLoungeStellaShoutout({ ...receipt, ...change }), false);
});

test('a confirmed self !so traverses both production bot guards, while synthetic echoes stay blocked', () => {
  // Execute the actual guard expressions from both production entry points.
  const client = fs.readFileSync(path.join(__dirname, '../src/services/twitch-client.ts'), 'utf8');
  const dispatcher = fs.readFileSync(path.join(__dirname, '../src/services/chat-dispatcher.ts'), 'utf8');
  const clientGuard = client.match(/if \((self && msgTenantId[\s\S]*?)\) return;/)[1];
  const selfGuard = dispatcher.match(/if \(((?:\(self &&)[^\n]+)\) return;/)[1];
  const commandGuard = dispatcher.match(/if \((isCommand && \(!isBot[^\n]+)\) \{/)[1];
  for (const [id, allowed] of [['receipt-id', true], ['', false]]) {
    const tags = { username: 'stellabot87', id };
    const message = '!so player_channel';
    const permitted = isConfirmedLoungeStellaShoutout({ tenantId: 'spacemountainlive', channel: 'spacemountainlive', tags, message });
    const context = { self: true, msgTenantId: 'spacemountainlive', channelName: 'spacemountainlive', tags, message,
      SPACEMOUNTAIN_SYSTEM_TENANT_ID: 'spacemountainlive', SPACEMOUNTAIN_SYSTEM_TWITCH_CHANNEL: 'spacemountainlive',
      isConfirmedLoungeStellaShoutout, isSpaceMountainBroadcasterCommand: false, isStellaShoutoutCommand: permitted,
      isTheCountAccountMessage: false, isCommand: true, isBot: true };
    assert.equal(vm.runInNewContext(clientGuard, context), !allowed);
    assert.equal(vm.runInNewContext(selfGuard, context), !allowed);
    assert.equal(vm.runInNewContext(commandGuard, context), allowed);
  }
});
function fixture({ identity, status = 204, getCredential, chatStatus = 200, chatReceipt = { is_sent: true, message_id: 'chat-receipt' } } = {}) {
  let timestamp = 1_000_000;
  const calls = [];
  const service = createStellaCheckinShoutout({
    getCredential: getCredential || (async () => ({ token: 'test-only-credential', clientId: 'client' })),
    now: () => timestamp,
    fetchImpl: async (url, options) => {
      calls.push({ url, ...options });
      if (url.includes('/validate')) return { ok: true, json: async () => identity || ({ login: 'stellabot87', user_id: 'stella-id', client_id: 'client', scopes: ['moderator:manage:shoutouts', 'user:write:chat'] }) };
      if (url.includes('/users?')) return { ok: true, json: async () => ({ data: [
        { login: 'spacemountainlive', id: 'lounge-id' },
        { login: new URL(url).searchParams.getAll('login')[1], id: 'source-id' },
      ] }) };
      if (url.endsWith('/chat/messages')) return { ok: chatStatus === 200, status: chatStatus, json: async () => ({ data: [chatReceipt] }) };
      return { status };
    },
  });
  return { service, calls, advance: ms => { timestamp += ms; } };
}

test('Stella executes the native action in the Lounge for the source channel', async () => {
  const f = fixture();
  assert.equal(f.calls.length, 0, 'initialization must not send a shoutout');
  const result = await f.service.send('#Player_Channel');
  assert.equal(result.status, 'sent');
  assert.equal(result.sender, 'stellabot87');
  assert.equal(result.destination, 'spacemountainlive');
  const send = f.calls.find(call => call.method === 'POST');
  const url = new URL(send.url);
  assert.equal(url.pathname, '/helix/chat/shoutouts');
  assert.equal(url.searchParams.get('from_broadcaster_id'), 'lounge-id');
  assert.equal(url.searchParams.get('to_broadcaster_id'), 'source-id');
  assert.equal(url.searchParams.get('moderator_id'), 'stella-id');
  assert.equal(send.headers.Authorization, 'Bearer test-only-credential');
  assert.match(formatCheckinShoutoutReply(result), /#player_channel/);
  assert.doesNotMatch(JSON.stringify(result), /test-only-credential/);
});

test('Stella also posts the exact !so command in the Lounge using her confirmed chat identity', async () => {
  const f = fixture();
  assert.equal((await f.service.send('player_channel')).status, 'sent');
  assert.equal((await f.service.send('player_channel')).status, 'cooldown');
  const result = await f.service.sendChatCommand('#Player_Channel');
  assert.equal(result.status, 'sent');
  assert.equal(result.messageId, 'chat-receipt');
  assert.equal(result.sender, 'stellabot87');
  assert.equal(result.destination, 'spacemountainlive');
  const sends = f.calls.filter(call => call.url.endsWith('/chat/messages'));
  assert.equal(sends.length, 1);
  assert.deepEqual(JSON.parse(sends[0].body), {
    broadcaster_id: 'lounge-id', sender_id: 'stella-id', message: '!so player_channel',
  });
  assert.equal(sends[0].headers.Authorization, 'Bearer test-only-credential');
  assert.equal(formatCheckinChatShoutoutReply(result), '');
  assert.doesNotMatch(JSON.stringify(result), /test-only-credential/);
});

test('chat and native permissions are independent, and a chat send does not consume native cooldown', async () => {
  const f = fixture();
  assert.equal((await f.service.sendChatCommand('source')).status, 'sent');
  assert.equal((await f.service.send('source')).status, 'sent');
  const chatOnly = fixture({ identity: { login: 'stellabot87', user_id: 'stella-id', client_id: 'client', scopes: ['user:write:chat'] } });
  assert.equal((await chatOnly.service.send('source')).status, 'missing-shoutout-permission');
  assert.equal((await chatOnly.service.sendChatCommand('source')).status, 'sent');
  const nativeOnly = fixture({ identity: { login: 'stellabot87', user_id: 'stella-id', client_id: 'client', scopes: ['moderator:manage:shoutouts'] } });
  assert.equal((await nativeOnly.service.sendChatCommand('source')).status, 'missing-chat-permission');
  assert.equal(nativeOnly.calls.filter(call => call.method === 'POST').length, 0);
});

for (const [chatStatus, chatReceipt, expected] of [
  [200, { is_sent: false, message_id: '', drop_reason: { code: 'automod_held' } }, 'not-sent'],
  [200, { is_sent: true }, 'not-sent'],
  [401, null, 'authorization-required'],
  [403, null, 'authorization-required'],
  [429, null, 'rate-limited'],
  [500, null, 'unavailable'],
]) test(`!so requires confirmed delivery: ${chatStatus} / ${JSON.stringify(chatReceipt)}`, async () => {
  const f = fixture({ chatStatus, chatReceipt });
  const result = await f.service.sendChatCommand('source');
  assert.equal(result.status, expected);
  assert.equal(result.messageId, undefined);
  assert.match(formatCheckinChatShoutoutReply(result), /could not post !so/);
  assert.equal(f.calls.filter(call => call.method === 'POST').length, 1);
  assert.equal((await f.service.send('source')).status, 'sent', 'chat failure must not block native shoutouts');
});

test('!so refuses wrong accounts, invalid targets, and Lounge self-check-ins', async () => {
  const f = fixture();
  assert.equal((await f.service.sendChatCommand('bad/channel')).status, 'invalid-channel');
  assert.equal((await f.service.sendChatCommand('spacemountainlive')).status, 'self-shoutout');
  assert.equal(f.calls.length, 0);
  const wrong = fixture({ identity: { login: 'spacemountainlive', user_id: 'lounge-id', client_id: 'client', scopes: ['user:write:chat'] } });
  assert.equal((await wrong.service.sendChatCommand('source')).status, 'wrong-stella-account');
  assert.equal(wrong.calls.filter(call => call.method === 'POST').length, 0);
});

test('concurrent check-ins obey the global and per-channel Twitch cooldowns', async () => {
  const f = fixture();
  const results = await Promise.all([f.service.send('first'), f.service.send('second')]);
  assert.deepEqual(Array.from(results, x => x.status), ['sent', 'cooldown']);
  f.advance(120000);
  assert.equal((await f.service.send('first')).status, 'cooldown');
  assert.equal((await f.service.send('second')).status, 'sent');
  f.advance(3600000);
  assert.equal((await f.service.send('first')).status, 'sent');
  assert.equal(f.calls.filter(x => x.method === 'POST').length, 3);
});

for (const [identity, expected] of [
  [{ login: 'spacemountainlive', user_id: 'lounge-id', client_id: 'client', scopes: ['moderator:manage:shoutouts'] }, 'wrong-stella-account'],
  [{ login: 'stellabot87', user_id: 'stella-id', client_id: 'another-client', scopes: ['moderator:manage:shoutouts'] }, 'wrong-stella-account'],
  [{ login: 'stellabot87', user_id: 'stella-id', client_id: 'client', scopes: ['chat:edit'] }, 'missing-shoutout-permission'],
]) test(`invalid authorization is blocked: ${expected} / ${identity.login}`, async () => {
  const f = fixture({ identity });
  assert.equal((await f.service.send('source')).status, expected);
  assert.equal(f.calls.length, 1);
});

for (const [status, expected] of [[400, 'not-eligible'], [401, 'authorization-required'], [403, 'authorization-required'], [429, 'cooldown'], [500, 'unavailable']]) {
  test(`Twitch ${status} is reported accurately and never retried`, async () => {
    const f = fixture({ status });
    const result = await f.service.send('source');
    assert.equal(result.status, expected);
    assert.doesNotMatch(formatCheckinShoutoutReply(result), /Stella sent/);
    assert.equal(f.calls.filter(x => x.method === 'POST').length, 1);
  });
}

test('invalid targets and Lounge self-check-ins never reach Twitch', async () => {
  const f = fixture();
  assert.equal((await f.service.send('bad/channel')).status, 'invalid-channel');
  const self = await f.service.send('spacemountainlive');
  assert.equal(self.status, 'self-shoutout');
  assert.equal(formatCheckinShoutoutReply(self), '');
  assert.equal(f.calls.length, 0);
});

test('reauthorization is read on the next command without a process restart', async () => {
  let connected = false;
  const f = fixture({ getCredential: async () => {
    if (!connected) throw Error('not connected');
    return { token: 'test-only-credential', clientId: 'client' };
  } });
  assert.equal((await f.service.send('source')).status, 'unavailable');
  connected = true;
  assert.equal((await f.service.send('source')).status, 'sent');
});

test('runtime loads only the system tenant bot grant through the existing refresh manager', async () => {
  const seen = [];
  const service = load('src/services/checkin-shoutout.ts', id => {
    if (id.includes('token-utils')) return {
      getStoredTokens: async tenant => { seen.push(tenant); return { botUsername: 'stellabot87' }; },
      ensureValidToken: async (client, secret, role, tokens, tenant) => { seen.push([client, role, tenant]); return 'test-only-credential'; },
    };
    return { SPACEMOUNTAIN_SYSTEM_TENANT_ID: 'spacemountainlive' };
  }, { TWITCH_CLIENT_ID: 'client', TWITCH_CLIENT_SECRET: 'test-secret' });
  await service.sendStellaCheckinShoutout('source');
  assert.deepEqual(JSON.parse(JSON.stringify(seen)), ['spacemountainlive', ['client', 'bot', 'spacemountainlive']]);
});

async function authorize(role, owner = true) {
  const route = load('src/app/api/auth/twitch/route.ts', id => {
    if (id === 'next/server') return { NextResponse: {
      json: (body, options) => ({ body, ...options }),
      redirect: url => ({ url, cookies: { set() {} } }),
    } };
    if (id.includes('runtime-origin')) return { getOAuthRedirectUri: () => 'https://example.test/callback' };
    if (id.includes('tenant-context')) return { getTenantFromRequest: () => ({ tenantId: 'owner-id' }) };
    if (id.includes('privileged-oauth')) return { createPrivilegedTwitchOAuthTransaction: () => ({ state: 'signed-state', cookieValue: 'signed-cookie' }) };
    if (id === '@/lib/tenant') return { isAdmin: () => owner };
    throw Error(id);
  }, { TWITCH_CLIENT_ID: 'client' });
  const url = `https://example.test/api/auth/twitch?role=${role}`;
  return route.GET({ url, nextUrl: new URL(url) });
}

test('Stella reconnect requests shoutout scope and preserves all existing chat scopes', async () => {
  const response = await authorize('space-mountain-bot');
  const url = new URL(response.url);
  assert.equal(url.searchParams.get('state'), 'signed-state');
  assert.equal(url.searchParams.get('force_verify'), 'true');
  const scopes = url.searchParams.get('scope').split(' ');
  assert.deepEqual(scopes, ['chat:read', 'chat:edit', 'user:read:chat', 'user:write:chat', 'user:bot', 'moderator:manage:shoutouts']);
  assert.equal((await authorize('space-mountain-bot', false)).status, 403);
  const count = new URL((await authorize('the-count')).url);
  assert.equal(count.searchParams.get('scope').includes('shoutouts'), false);
});
