import test from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { parseSessionCookie, serializeSessionCookie } from '../src/lib/session-cookie';
import { middleware } from '../src/middleware';
import { GET as migrateLegacySession } from '../src/app/api/session/migrate/route';

test('StreamWeaver session rejects unsigned and tampered tenant cookies', () => {
  process.env.STREAMWEAVER_SESSION_SECRET = 'test-session-secret-that-is-not-used-in-production';
  const unsigned = JSON.stringify({ id: 'tenant-a', username: 'owner' });
  assert.equal(parseSessionCookie(unsigned), null);

  const signed = serializeSessionCookie({ id: 'tenant-a', username: 'owner' });
  assert.equal(parseSessionCookie(signed)?.id, 'tenant-a');
  const tampered = `${signed[0] === 'A' ? 'B' : 'A'}${signed.slice(1)}`;
  assert.equal(parseSessionCookie(tampered), null);
});

test('middleware passes signed session candidates to the Node page guard', async () => {
  const request = new NextRequest('https://streamweaver-new.fly.dev/dashboard', {
    headers: { cookie: 'streamweaver-session=payload.signature' },
  });
  const response = await middleware(request);
  assert.equal(response.headers.get('x-middleware-next'), '1');
});

test('middleware rejects requests without a signed session candidate', async () => {
  const request = new NextRequest('https://streamweaver-new.fly.dev/dashboard');
  const response = await middleware(request);
  assert.equal(response.status, 307);
  assert.equal(new URL(String(response.headers.get('location'))).pathname, '/login');
});

test('middleware limits SPMT service access to the feed and dispatch routes', async () => {
  const original = process.env.SPMT_SYSTEM_KEY;
  process.env.SPMT_SYSTEM_KEY = 'test-spmt-system-key';
  try {
    for (const pathname of ['/api/shared-chat/spmt-feed', '/api/shared-chat/spmt-dispatch']) {
      const allowed = await middleware(new NextRequest(`https://streamweaver-new.fly.dev${pathname}`, {
        headers: { 'x-spmt-key': 'test-spmt-system-key' },
      }));
      assert.equal(allowed.headers.get('x-middleware-next'), '1');
    }
    const denied = await middleware(new NextRequest('https://streamweaver-new.fly.dev/api/shared-chat/spmt-dispatch', {
      headers: { 'x-spmt-key': 'wrong' },
    }));
    assert.equal(denied.status, 401);
  } finally {
    if (original === undefined) delete process.env.SPMT_SYSTEM_KEY;
    else process.env.SPMT_SYSTEM_KEY = original;
  }
});

test('legacy SPMT migration verifies the provider identity and signs in Node runtime', async () => {
  const originalFetch = global.fetch;
  const originalAppUrl = process.env.NEXT_PUBLIC_BASE_URL;
  process.env.STREAMWEAVER_SESSION_SECRET = 'test-session-secret-that-is-not-used-in-production';
  process.env.NEXT_PUBLIC_BASE_URL = 'https://streamweaver-new.fly.dev';
  global.fetch = async () => Response.json({
    id: 'spmt-user-a',
    username: 'owner',
    twitchId: 'tenant-a',
    twitchUsername: 'owner',
    displayName: 'Owner',
  });

  try {
    const request = new NextRequest('https://streamweaver-new.fly.dev/api/session/migrate?next=%2Fdashboard');
    request.cookies.set('streamweaver-session', JSON.stringify({ id: 'tenant-a', username: 'owner' }));
    request.cookies.set('streamweaver-spmt-token', 'provider-token');
    const response = await migrateLegacySession(request);
    const signed = response.cookies.get('streamweaver-session')?.value;
    assert.equal(response.status, 307);
    assert.equal(new URL(String(response.headers.get('location'))).pathname, '/dashboard');
    assert.equal(parseSessionCookie(signed)?.id, 'tenant-a');
  } finally {
    global.fetch = originalFetch;
    if (originalAppUrl === undefined) delete process.env.NEXT_PUBLIC_BASE_URL;
    else process.env.NEXT_PUBLIC_BASE_URL = originalAppUrl;
  }
});
