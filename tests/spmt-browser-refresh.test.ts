import assert from 'node:assert/strict';
import test from 'node:test';
import { NextRequest, NextResponse } from 'next/server';
import { middleware } from '../src/middleware';
import { parseSessionCookie } from '../src/lib/session-cookie';
import { clearSpmtSessionCookies } from '../src/lib/spmt-oauth';
process.env.STREAMWEAVER_CLIENT_SECRET = 'test-client';
process.env.STREAMWEAVER_SESSION_SECRET = 'test-session';
const user = { id: 'canonical-user', username: 'spmt-name', twitchId: '12345', twitchUsername: 'linked_twitch', discordId: '987654321000', discordUsername: 'linked_discord' };
test('expired browser credentials renew access, refresh and local image session in the current request', async (t) => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  for (const path of ['/api/ai/image', '/api/session', '/api/spmt/workspace-theme']) {
    const calls: string[] = [];
    globalThis.fetch = async (input, init) => {
      const url = String(input); calls.push(url);
      if (url.endsWith('/api/oauth/userinfo')) return new Response('{}', { status: 401 });
      assert.ok(url.endsWith('/api/oauth/token'));
      assert.equal(JSON.parse(String(init?.body)).refresh_token, 'saved-refresh');
      return new Response(JSON.stringify({ access_token: 'new-access', refresh_token: 'new-refresh', user, expires_in: 604800, refresh_expires_in: 2592000 }));
    };
    const request = new NextRequest(`https://streamweaver-new.fly.dev${path}`, { method: path === '/api/ai/image' ? 'POST' : 'GET', headers: { cookie: 'streamweaver-spmt-token=expired; streamweaver-spmt-refresh=saved-refresh' } });
    const response = await middleware(request);
    assert.equal(response.status, 200, path);
    const forwarded = response.headers.get('x-middleware-request-cookie') || '';
    assert.match(forwarded, /streamweaver-spmt-token=new-access/);
    assert.match(forwarded, /streamweaver-spmt-refresh=new-refresh/);
    const local = parseSessionCookie(request.cookies.get('streamweaver-session')?.value);
    assert.equal(local?.id, '12345');
    assert.equal(local?.spmtUserId, 'canonical-user');
    assert.equal(local?.username, 'linked_twitch');
    const cookies = response.headers.getSetCookie();
    assert.ok(cookies.some(c => c.startsWith('streamweaver-session=') && c.includes('Partitioned') && !c.includes('Max-Age=0')));
    assert.ok(cookies.some(c => c.startsWith('streamweaver-spmt-refresh=new-refresh') && c.includes('Partitioned')));
    assert.ok(cookies.some(c => c.startsWith('streamweaver-spmt-refresh=;') && !c.includes('Partitioned')));
    assert.equal(calls.length, 2);
  }
});
test('logout clears both current and legacy cookie storage', () => {
  const response = NextResponse.json({ success: true });
  clearSpmtSessionCookies(response);
  for (const name of ['streamweaver-session', 'streamweaver-spmt-token', 'streamweaver-spmt-refresh']) {
    const cookies = response.headers.getSetCookie().filter(c => c.startsWith(name + '='));
    assert.equal(cookies.length, 2);
    assert.ok(cookies.every(c => c.includes('Max-Age=0')));
    assert.ok(cookies.some(c => c.includes('Partitioned')));
    assert.ok(cookies.some(c => !c.includes('Partitioned')));
  }
});
test('a still-valid SPMT access token restores an expired local session without consuming refresh', async (t) => {
  const original = globalThis.fetch; t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async (input) => {
    assert.ok(String(input).endsWith('/api/oauth/userinfo'));
    return new Response(JSON.stringify(user));
  };
  const req = new NextRequest('https://streamweaver-new.fly.dev/api/ai/image', { method: 'POST', headers: { cookie: 'streamweaver-spmt-token=valid' } });
  const res = await middleware(req);
  assert.equal(res.status, 200);
  assert.equal(parseSessionCookie(req.cookies.get('streamweaver-session')?.value)?.id, '12345');
  assert.ok(res.cookies.get('streamweaver-session')?.value);
});
