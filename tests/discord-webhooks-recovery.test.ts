import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

test('a cached Discord webhook 404 is recreated and the message is retried once', async () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'src/services/discord-webhooks.ts'), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;

  let persisted = JSON.stringify({
    'channel-1': {
      url: 'https://discord.com/api/webhooks/stale-id/stale-token',
      username: 'Old Signal',
      avatarUrl: 'https://cdn.discordapp.com/embed/avatars/0.png',
    },
  });
  const writes: Array<{ url: string; method: string }> = [];
  const response = (status: number, payload: unknown) => ({
    status,
    ok: status >= 200 && status < 300,
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  });
  const fetchMock = async (url: string, init: { method?: string } = {}) => {
    const method = init.method || 'GET';
    writes.push({ url, method });
    if (url === 'https://discord.com/api/webhooks/stale-id/stale-token?wait=true') {
      return response(404, { message: 'Unknown Webhook', code: 10015 });
    }
    if (url === 'https://discord.com/api/v10/channels/channel-1/webhooks' && method === 'POST') {
      return response(200, { id: 'fresh-id', token: 'fresh-token' });
    }
    if (url === 'https://discord.com/api/webhooks/fresh-id/fresh-token?wait=true') {
      return response(200, { id: 'message-123', channel_id: 'channel-1' });
    }
    throw new Error('Unexpected Discord request: ' + method + ' ' + url);
  };
  const fsMock = {
    readFile: async () => persisted,
    mkdir: async () => undefined,
    writeFile: async (_filePath: string, value: string) => { persisted = value; },
  };
  const requireMock = (id: string) => {
    if (id === 'fs/promises') return fsMock;
    if (id === 'path') return path;
    if (id === '../lib/tenant') return { tenantPath: (tenantId: string, file: string) => path.join('/tmp', tenantId, file) };
    return require(id);
  };
  const mod = { exports: {} as Record<string, any> };
  vm.runInNewContext(compiled, {
    module: mod,
    exports: mod.exports,
    require: requireMock,
    process: { env: { DISCORD_BOT_TOKEN: 'test-token' }, cwd: () => '/app' },
    fetch: fetchMock,
    console,
    URL,
    Buffer,
    FormData,
    Blob,
    Map,
    Set,
    Date,
    JSON,
    Math,
  });

  const result = await mod.exports.sendWebhookMessage('channel-1', '', 'Signal User', 'https://cdn.discordapp.com/embed/avatars/0.png', [{ title: 'SIGNAL' }]);
  assert.equal(result.id, 'message-123');
  assert.equal(writes.length, 3);
  assert.equal(writes[0].url, 'https://discord.com/api/webhooks/stale-id/stale-token?wait=true');
  assert.equal(writes[1].url, 'https://discord.com/api/v10/channels/channel-1/webhooks');
  assert.equal(writes[2].url, 'https://discord.com/api/webhooks/fresh-id/fresh-token?wait=true');
  assert.match(persisted, /fresh-token/);
});
