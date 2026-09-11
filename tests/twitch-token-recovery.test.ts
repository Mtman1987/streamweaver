import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { execFileSync, spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import ts from 'typescript';
const nativeRequire = createRequire(import.meta.url);
function load(file: string, mocks: Record<string, any>, globals: Record<string, any> = {}) {
  const source = process.env.TEST_BASELINE ? execFileSync('git', ['show', `HEAD:${file}`], { encoding: 'utf8' }) : readFileSync(file, 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const module = { exports: {} as any };
  vm.runInNewContext(code, { module, exports: module.exports, require: (id: string) => id in mocks ? mocks[id] : nativeRequire(id), process, Buffer, URLSearchParams, AbortSignal, console: { log() {}, warn() {}, error() {} }, setTimeout: () => ({ unref() {} }), clearTimeout() {}, global: {}, ...globals }, { filename: file });
  return module.exports;
}
async function fixture(t: any, fetch: typeof globalThis.fetch) {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'twitch-refresh-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const mocks = { './tenant': { tenantPath: (id: string) => path.join(root, id, 'tokens.json'), communityBotTokensPath: () => path.join(root, 'community.json') } };
  const api = load('src/lib/token-utils.server.ts', mocks, { fetch });
  api.root = root;
  api.fork = () => load('src/lib/token-utils.server.ts', mocks, { fetch });
  return api;
}
const tokens = { broadcasterToken: 'test-old-access', broadcasterRefreshToken: 'test-old-refresh', broadcasterTokenExpiry: Date.now() + 3600000, broadcasterUsername: 'registered', botUsername: 'personal' };
const refreshed = (role: string) => Response.json({ access_token: `test-new-${role}`, refresh_token: `test-refresh-${role}`, expires_in: 3600, token_type: 'bearer' });
test('force refresh exchanges the durable grant despite a future saved expiry', async t => {
  let exchanges = 0;
  const api = await fixture(t, async (_url: any, init: any) => { if (init.method === 'POST') { exchanges++; return refreshed('broadcaster'); } return Response.json({}); });
  await api.storeTokens(tokens, '123');
  assert.equal(await api.forceRefreshStoredToken('client', 'secret', 'broadcaster', '123'), 'test-new-broadcaster');
  assert.equal(exchanges, 1);
});
test('validation outages do not rotate or permanently pause credentials', async t => {
  let exchanges = 0;
  const api = await fixture(t, async (_url: any, init: any) => { if (init.method === 'POST') { exchanges++; return refreshed('broadcaster'); } return new Response('', { status: 503 }); });
  await api.storeTokens(tokens, '123');
  await assert.rejects(api.ensureValidToken('client', 'secret', 'broadcaster', tokens, '123'), /temporarily unavailable/);
  assert.equal(exchanges, 0);
  assert.equal(api.isTwitchAuthFailure(new Error('Failed to refresh token: 503 Service Unavailable')), false);
  assert.equal(api.isTwitchAuthFailure(new Error('Failed to refresh token: 400 Bad Request - Invalid refresh token')), true);
});
test('valid access remains usable without legacy expiry or refresh fields', async t => {
  const api = await fixture(t, async (_url: any, init: any) => { assert.notEqual(init.method, 'POST'); return Response.json({}); });
  const legacy = { broadcasterToken: 'test-valid-access' };
  await api.storeTokens(legacy, '123');
  assert.equal(await api.ensureValidToken('client', 'secret', 'broadcaster', legacy, '123'), legacy.broadcasterToken);
});
test('a refresh grant recovers a missing access token', async t => {
  const api = await fixture(t, async () => refreshed('broadcaster'));
  const legacy = { broadcasterRefreshToken: 'test-refresh-only' };
  await api.storeTokens(legacy, '123');
  assert.equal(await api.ensureValidToken('client', 'secret', 'broadcaster', legacy, '123'), 'test-new-broadcaster');
});
test('concurrent broadcaster and bot rotations preserve both grants', async t => {
  const api = await fixture(t, async (_url: any, init: any) => {
    if (init.method !== 'POST') return Response.json({});
    await new Promise(resolve => setTimeout(resolve, 15));
    return refreshed(new URLSearchParams(init.body).get('refresh_token') === 'bot-refresh' ? 'bot' : 'broadcaster');
  });
  const expired = { ...tokens, broadcasterTokenExpiry: 1, botToken: 'bot-access', botRefreshToken: 'bot-refresh', botTokenExpiry: 1 };
  await api.storeTokens(expired, '123');
  await Promise.all(['broadcaster', 'bot'].map(role => api.ensureValidToken('client', 'secret', role, expired, '123')));
  const saved = await api.getStoredTokens('123');
  assert.equal(saved.broadcasterRefreshToken, 'test-refresh-broadcaster');
  assert.equal(saved.botRefreshToken, 'test-refresh-bot');
});
test('a replacement grant releases a pause even if timestamps are unchanged', async t => {
  const api = await fixture(t, async () => Response.json({}));
  const gate = new api.ProactiveTwitchRefreshGate();
  gate.markReauthorizationRequired('123', tokens);
  assert.equal(gate.shouldAttempt('123', tokens), false);
  assert.equal(gate.shouldAttempt('123', { ...tokens, broadcasterRefreshToken: 'replacement' }), true);
});
async function runtimeFixture(t: any, failRole: 'bot' | 'broadcaster') {
  const tokenApi = await fixture(t, async () => Response.json({}));
  let stored: any = { ...tokens, botToken: 'personal-token', botRefreshToken: 'personal-refresh' };
  let failing = true;
  const calls: string[] = [];
  const dispatched: string[] = [];
  class Client extends EventEmitter {
    state = 'CLOSED';
    constructor(public options: any) { super(); }
    async connect() { this.state = 'OPEN'; this.emit('connected'); }
    async disconnect() { this.state = 'CLOSED'; }
    readyState() { return this.state; }
    async join() {}
    async say() {}
  }
  const runtime = load('src/services/twitch-client.ts', {
    'tmi.js': { Client },
    '../lib/token-utils.server': { ...tokenApi, getStoredTokens: async () => stored, ensureValidToken: async (_a: any, _b: any, role: string) => { calls.push(role); if (failing && role === failRole) throw new Error('Invalid refresh token'); return `${role}-valid`; } },
    '../lib/tenant': { listTenants: async () => ['123'], communityBotTokensPath: () => '/test-community', getAdminTwitchId: () => '999' },
    './chat-dispatcher': { handleTwitchMessage: async (_channel: string, _tags: any, message: string) => { dispatched.push(message); } },
    './shared-chat-ingestion': { recordSharedChatEvent: async () => {} }, './shared-chat-normalizers': { normalizeTwitchSharedChatEvent: () => ({}) },
    './shared-chat': { shouldIgnoreMirrored: () => false, isMirroredSharedMessage: () => false },
    'fs': { promises: { readFile: async () => JSON.stringify({ communityBotToken: 'community', communityBotRefreshToken: 'community-refresh', communityBotUsername: 'streamweaverbot' }) } },
    '../lib/runtime-origin': { getConfiguredAppUrl: () => 'https://example.test' },
    '../lib/the-count-twitch-vault.server': { readTheCountTwitchCredential: async () => null }, '../lib/the-count': { THE_COUNT_TWITCH_LOGIN: 'count' },
  }, { process: { env: { TWITCH_CLIENT_ID: 'test-client', TWITCH_CLIENT_SECRET: 'test-secret' } }, fetch: async () => Response.json({ user_id: '123', login: 'registered' }) });
  return { runtime, calls, dispatched, replaceGrant() { failing = false; stored = { ...stored, broadcasterRefreshToken: 'replacement' }; } };
}
test('expired optional bot does not stop the broadcaster and shared bot fallback', async t => {
  const { runtime } = await runtimeFixture(t, 'bot');
  await runtime.setupTwitchClient('123');
  assert.equal(runtime.getTwitchStatus('123'), 'connected');
  assert.ok(runtime.getTwitchClient('broadcaster', '123'));
  assert.equal(runtime.getTwitchClient('bot', '123').options.identity.username, 'streamweaverbot');
});
test('failed broadcaster refresh retains routing and maintenance reloads replacement credentials', async t => {
  const { runtime, calls, replaceGrant } = await runtimeFixture(t, 'broadcaster');
  await runtime.setupTwitchClient('123');
  assert.equal(runtime.getTenantIdFromChannel('#registered'), '123');
  assert.ok(runtime.getTwitchClient('bot', '123'));
  await runtime.reconnectDisconnectedTenants();
  assert.equal(calls.filter(x => x === 'broadcaster').length, 1);
  replaceGrant();
  await runtime.reconnectDisconnectedTenants();
  assert.equal(runtime.getTwitchStatus('123'), 'connected');
});

test('shared bot runs registered tenant commands while broadcaster grant needs repair', async t => {
  const { runtime, dispatched } = await runtimeFixture(t, 'broadcaster');
  await runtime.setupTwitchClient('123');
  const bot = runtime.getTwitchClient('bot', '123');
  assert.ok(bot);
  for (const listener of bot.listeners('message')) await listener('#registered', { username: 'viewer' }, '!points', false);
  assert.deepEqual(dispatched, ['!points']);
});

test('independent Next and bot module instances serialize updates to the same file', async t => {
  const api = await fixture(t, async (_url: any, init: any) => {
    if (init.method !== 'POST') return Response.json({});
    await new Promise(resolve => setTimeout(resolve, 25));
    return refreshed(new URLSearchParams(init.body).get('refresh_token') === 'bot-refresh' ? 'bot' : 'broadcaster');
  });
  const second = api.fork();
  const expired = { ...tokens, broadcasterTokenExpiry: 1, botToken: 'bot-access', botRefreshToken: 'bot-refresh', botTokenExpiry: 1 };
  await api.storeTokens(expired, '123');
  await Promise.all([
    api.ensureValidToken('client', 'secret', 'broadcaster', expired, '123'),
    second.ensureValidToken('client', 'secret', 'bot', expired, '123'),
  ]);
  const saved = await api.getStoredTokens('123');
  assert.equal(saved.broadcasterRefreshToken, 'test-refresh-broadcaster');
  assert.equal(saved.botRefreshToken, 'test-refresh-bot');
});
test('OAuth callback merges its new grant after an in-flight background refresh', async t => {
  let began!: () => void;
  const started = new Promise<void>(resolve => { began = resolve; });
  const api = await fixture(t, async () => { began(); await new Promise(resolve => setTimeout(resolve, 30)); return refreshed('broadcaster'); });
  const expired = { ...tokens, broadcasterTokenExpiry: 1, botToken: 'keep-personal-bot' };
  await api.storeTokens(expired, '123');
  const background = api.ensureValidToken('client', 'secret', 'broadcaster', expired, '123');
  await started;
  await Promise.all([background, api.fork().updateStoredTokens({ broadcasterToken: 'callback-access', broadcasterRefreshToken: 'callback-refresh' }, '123')]);
  const saved = await api.getStoredTokens('123');
  assert.equal(saved.broadcasterRefreshToken, 'callback-refresh');
  assert.equal(saved.botToken, 'keep-personal-bot');
});
test('explicit disconnect wins over an in-flight refresh and cannot be resurrected by a queued reader', async t => {
  let began!: () => void;
  const started = new Promise<void>(resolve => { began = resolve; });
  const api = await fixture(t, async () => { began(); await new Promise(resolve => setTimeout(resolve, 30)); return refreshed('broadcaster'); });
  const expired = { ...tokens, broadcasterTokenExpiry: 1 };
  await api.storeTokens(expired, '123');
  const background = api.ensureValidToken('client', 'secret', 'broadcaster', expired, '123');
  await started;
  const second = api.fork();
  await Promise.all([background, second.updateStoredTokens(() => ({}), '123')]);
  await assert.rejects(second.ensureValidToken('client', 'secret', 'broadcaster', expired, '123'), /Missing/);
  assert.deepEqual(JSON.parse(JSON.stringify(await api.getStoredTokens('123'))), {});
});

test('separate operating-system processes preserve concurrent token rotations', async t => {
  const api = await fixture(t, async () => Response.json({}));
  const expired = { ...tokens, broadcasterTokenExpiry: 1, botToken: 'bot-access', botRefreshToken: 'bot-refresh', botTokenExpiry: 1 };
  await api.storeTokens(expired, '123');
  const source = readFileSync('src/lib/token-utils.server.ts', 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const script = `
    const fs = require('fs'), path = require('path'), Module = require('module');
    const root = process.argv[1], role = process.argv[2];
    const m = new Module(__filename);
    m.require = id => id === './tenant' ? {
      tenantPath: id => path.join(root, id, 'tokens.json'),
      communityBotTokensPath: () => path.join(root, 'community.json')
    } : require(id);
    global.fetch = async (_url, init) => {
      if (init.method !== 'POST') return Response.json({});
      await new Promise(resolve => setTimeout(resolve, 150));
      return Response.json({ access_token: 'child-access-' + role, refresh_token: 'child-refresh-' + role, expires_in: 3600 });
    };
    m._compile(${JSON.stringify(compiled)}, 'token-child.cjs');
    m.exports.ensureValidToken('client', 'secret', role, {}, '123').catch(error => { console.error(error.message); process.exitCode = 1; });
  `;
  await Promise.all(['broadcaster', 'bot'].map(role => new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, ['-e', script, api.root, role], { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let error = '';
    child.stderr.on('data', chunk => { error += chunk; });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve() : reject(new Error(error)));
  })));
  const saved = await api.getStoredTokens('123');
  assert.equal(saved.broadcasterRefreshToken, 'child-refresh-broadcaster');
  assert.equal(saved.botRefreshToken, 'child-refresh-bot');
});

test('manual login exchange persists the grant and refuses unrelated or unavailable provider identities', async () => {
  for (const identity of ['123', '456', 'unavailable']) {
    const writes: any[] = [];
    const route = load('src/app/api/auth/twitch/manual-exchange/route.ts', {
      '@/lib/token-utils.server': { updateStoredTokens: async (...args: any[]) => { writes.push(args); } },
      'fs': { promises: { mkdir: async () => {}, readFile: async () => '{}' } },
      '@/lib/api-response': { apiError: (error: string, options: any) => ({ error, ...options }), apiOk: (payload: any) => ({ status: 200, ...payload }) },
      '@/lib/runtime-origin': { getOAuthRedirectUri: () => 'https://test/auth/twitch/callback' },
      '@/lib/tenant': { getTenantIdFromSession: () => '123', tenantPath: () => '/test/tokens.json', isAdmin: () => false },
    }, { process: { env: { TWITCH_CLIENT_ID: 'client', TWITCH_CLIENT_SECRET: 'secret' } }, fetch: async (url: string) =>
      url.endsWith('/token') ? refreshed('manual') : identity === 'unavailable' ? new Response('', { status: 503 }) : Response.json({ data: [{ id: identity, login: 'registered' }] }) });
    const result = await route.POST({ json: async () => ({ code: 'test-code', state: 'login' }), cookies: { get: () => ({ value: 'signed-test-session' }) }, nextUrl: { origin: 'https://test' } });
    assert.equal(result.status, identity === '123' ? 200 : identity === '456' ? 403 : 502);
    assert.equal(writes.length, identity === '123' ? 1 : 0);
    if (writes.length) assert.equal(writes[0][0].broadcasterRefreshToken, 'test-refresh-manual');
  }
});
