import assert from 'node:assert/strict';
import test from 'node:test';
import { NextRequest } from 'next/server';
import { middleware } from '../src/middleware';

test('service-owned Discord and Signal handlers are reachable without a browser session', async () => {
  for (const path of ['/api/discord/pokemon-interaction', '/api/internal/lost-signal/transmission', '/api/internal/known-bots', '/api/shared-chat/spmt-dispatch']) {
    const response = await middleware(new NextRequest(`https://streamweaver.test${path}`, {
      method: 'POST', headers: { Authorization: 'Bearer service-test-token' },
    }));
    assert.equal(response.headers.get('x-middleware-next'), '1', path);
  }
});

test('account admin APIs still require a verified user', async () => {
  const response = await middleware(new NextRequest('https://streamweaver.test/api/admin/tenants'));
  assert.equal(response.status, 401);
});

test('existing service credentials reach mixed chat, speech, Twitch and memory handlers', async () => {
  const original = process.env.BOT_SECRET_KEY;
  process.env.BOT_SECRET_KEY = 'service-test-token';
  try {
    for (const path of ['/api/chat/chatters', '/api/chat/log', '/api/tts', '/api/tts/current',
      '/api/twitch/events', '/api/twitch/create-clip', '/api/private-chat/finalize-discord-message',
      '/api/private-chat/respond', '/api/private-ltm/condense', '/api/ai/chat-with-memory']) {
      const response = await middleware(new NextRequest(`https://streamweaver.test${path}`, {
        method: 'POST', headers: { Authorization: 'Bearer service-test-token' },
      }));
      assert.equal(response.headers.get('x-middleware-next'), '1', path);
      const anonymous = await middleware(new NextRequest(`https://streamweaver.test${path}`, { method: 'POST' }));
      assert.equal(anonymous.status, 401, path);
    }
  } finally { if (original === undefined) delete process.env.BOT_SECRET_KEY; else process.env.BOT_SECRET_KEY = original; }
});
