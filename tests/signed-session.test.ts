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

test('middleware delegates signed session verification to the Node runtime route', async () => {
  const originalFetch = global.fetch;
  let verifyCalls = 0;
  global.fetch = async (input) => {
    const url = new URL(String(input));
    assert.equal(url.pathname, '/api/session');
    verifyCalls += 1;
    return Response.json({ id: 'tenant-a', username: 'owner' });
  };

  try {
    const request = new NextRequest('https://streamweaver-new.fly.dev/dashboard', {
      headers: { cookie: 'streamweaver-session=payload.signature' },
    });
    const response = await middleware(request);
    assert.equal(response.headers.get('x-middleware-next'), '1');
    assert.equal(verifyCalls, 1);
  } finally {
    global.fetch = originalFetch;
  }
});

test('middleware fails closed when the Node runtime rejects the signed session', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => new Response(null, { status: 401 });

  try {
    const request = new NextRequest('https://streamweaver-new.fly.dev/dashboard', {
      headers: { cookie: 'streamweaver-session=payload.signature' },
    });
    const response = await middleware(request);
    assert.equal(response.status, 307);
    assert.equal(new URL(String(response.headers.get('location'))).pathname, '/login');
  } finally {
    global.fetch = originalFetch;
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
