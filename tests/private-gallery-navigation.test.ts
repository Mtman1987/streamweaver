import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { NextRequest } from 'next/server';

process.env.STREAMWEAVER_SESSION_SECRET = 'private-gallery-navigation-test-secret';
process.env.APP_URL = 'https://streamweaver-new.fly.dev';
process.env.NODE_ENV = 'production';
process.env.PORT = '3000';

test('private gallery shortcut redirects the signed-in tenant to the production private library', async () => {
  const { serializeSessionCookie } = await import('../src/lib/session-cookie');
  const { GET } = await import('../src/app/private-gallery/route');
  const cookie = serializeSessionCookie({ id: 'tenant-private-gallery', username: 'owner' });

  // Fly/Next exposes an internal listener origin such as 0.0.0.0:3000 here.
  // Production routing must ignore it and use the configured public app URL.
  const response = await GET(new NextRequest('https://0.0.0.0:3000/private-gallery', {
    headers: { cookie: `streamweaver-session=${cookie}` },
  }));

  assert.equal(response.status, 307);
  const location = response.headers.get('location');
  assert.ok(location);
  const target = new URL(location!);
  assert.equal(target.origin, 'https://streamweaver-new.fly.dev');
  assert.equal(target.pathname, '/api/ai/image/library');
  assert.equal(target.searchParams.get('tenantId'), 'tenant-private-gallery');
  assert.equal(target.searchParams.get('scope'), 'private');
});

test('private gallery shortcut sends unsigned browsers to production login', async () => {
  const { GET } = await import('../src/app/private-gallery/route');
  const response = await GET(new NextRequest('https://0.0.0.0:3000/private-gallery'));
  assert.equal(response.status, 307);
  const target = new URL(response.headers.get('location')!);
  assert.equal(target.origin, 'https://streamweaver-new.fly.dev');
  assert.equal(target.pathname, '/login');
});

test('private gallery stays on its feature surface instead of duplicating global shell chrome', () => {
  const shell = readFileSync(new URL('../src/components/layout/app-shell.tsx', import.meta.url), 'utf8');
  const privateChat = readFileSync(new URL('../src/app/(app)/private-chat/page.tsx', import.meta.url), 'utf8');

  assert.doesNotMatch(shell, /href="\/private-gallery"/);
  assert.doesNotMatch(shell, /Open private gallery/);
  assert.match(privateChat, /href="\/private-gallery"/);
  assert.match(privateChat, /Open private gallery/);
});
