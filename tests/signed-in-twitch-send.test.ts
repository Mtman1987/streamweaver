import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';
import { sendSignedInTwitchMessage } from '../src/services/signed-in-twitch-send';
import { sendWithSharedChatAwareness } from '../src/services/shared-chat';

const input = { tenantId: '94371378', login: 'mtman1987', channel: 'thecaptaindash', message: 'Hello' };

for (const channel of ['thecaptaindash', 'spacemountainlive', undefined]) {
  test('microphone pins mtman1987 independently of destination ' + channel, async () => {
    const calls: unknown[] = [];
    const client = { getUsername: () => 'mtman1987' };
    const identity = await sendSignedInTwitchMessage({ ...input, channel }, {
      getClient: (tenantId) => { calls.push(tenantId); return client; },
      reconnect: async () => { throw new Error('Unexpected reconnect'); },
      send: async (actualClient, destination, login) => { calls.push([actualClient, destination, login]); },
    });
    assert.equal(identity, 'mtman1987');
    assert.deepEqual(calls, ['94371378', [client, channel || 'mtman1987', 'mtman1987']]);
  });
}

for (const login of ['thecaptaindash', 'streamweaverbot', '']) {
  test('microphone refuses mismatched sender ' + login, async () => {
    let sent = false;
    await assert.rejects(sendSignedInTwitchMessage(input, {
      getClient: () => ({ getUsername: () => login }),
      reconnect: async () => {},
      send: async () => { sent = true; },
    }), /signed-in Twitch account is not connected/);
    assert.equal(sent, false);
  });
}

test('missing human account reconnects only that account and fails without a substitute', async () => {
  const calls: string[] = [];
  await assert.rejects(sendSignedInTwitchMessage(input, {
    getClient: (id) => { calls.push('get:' + id); return null; },
    reconnect: async (id) => { calls.push('reconnect:' + id); },
    send: async () => { throw new Error('No send permitted'); },
  }), /signed-in Twitch account is not connected/);
  assert.deepEqual(calls, ['get:94371378', 'reconnect:94371378', 'get:94371378']);
});

test('shared-chat transport rejects an identity mismatch before any network send', async () => {
  let sent = false;
  await assert.rejects(sendWithSharedChatAwareness({
    client: { getUsername: () => 'thecaptaindash', say: async () => { sent = true; } },
    channel: 'thecaptaindash', message: 'Hello', as: 'broadcaster', tenantId: '94371378',
    expectedSenderLogin: 'mtman1987',
  }), /Signed-in Twitch sender is unavailable/);
  assert.equal(sent, false);
});

for (const retryLogin of [null, 'thecaptaindash', 'mtman1987']) {
  test('reconnect keeps the human identity: ' + retryLogin, async () => {
    const roles: string[] = [];
    const posted: string[] = [];
    const module = { exports: {} as any };
    const code = ts.transpileModule(readFileSync('src/services/shared-chat.ts', 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const mocks: Record<string, any> = {
      fs: { promises: { readFile: async () => { throw new Error('No fixture file'); } } },
      path: { resolve: (...parts: string[]) => parts.join('/') },
      '../lib/tenant': { tenantPath: () => '/fixture', communityBotTokensPath: () => '/fixture-community' },
      '../lib/the-count-twitch-vault.server': {},
      '../lib/the-count': {},
      './twitch-client': {
        setupTwitchClient: async (id: string) => { assert.equal(id, input.tenantId); },
        getTwitchClient: (role: string) => {
          roles.push(role);
          return retryLogin ? {
            getUsername: () => retryLogin, readyState: () => 'OPEN',
            getChannels: () => ['#thecaptaindash'],
            say: async () => { posted.push(retryLogin); },
          } : null;
        },
      },
    };
    vm.runInNewContext(code, {
      module, exports: module.exports,
      require: (name: string) => { if (!(name in mocks)) throw new Error('Unexpected dependency ' + name); return mocks[name]; },
      process: { env: {} }, console: { warn() {}, error() {}, log() {} }, global: {},
    });
    const send = module.exports.sendWithSharedChatAwareness({
      client: { getUsername: () => 'mtman1987', readyState: () => 'OPEN',
        getChannels: () => ['#thecaptaindash'], say: async () => { throw new Error('Connection lost'); } },
      channel: 'thecaptaindash', message: 'Hello', as: 'broadcaster',
      tenantId: input.tenantId, expectedSenderLogin: 'mtman1987',
    });
    if (retryLogin === 'mtman1987') await send;
    else await assert.rejects(send);
    assert.deepEqual(roles, ['broadcaster']);
    assert.deepEqual(posted, retryLogin === 'mtman1987' ? ['mtman1987'] : []);
  });
}
