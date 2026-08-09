import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { NextRequest } from 'next/server';

process.env.STREAMWEAVER_SESSION_SECRET = 'private-gallery-navigation-test-secret';

test('private gallery shortcut redirects the signed-in tenant to the private library', async () => {
  const { serializeSessionCookie } = await import('../src/lib/session-cookie');
  const { GET } = await import('../src/app/private-gallery/route');
  const cookie = serializeSessionCookie({ id: 'tenant-private-gallery', username: 'owner' });

  const response = await GET(new NextRequest('https://streamweaver.test/private-gallery', {
    headers: { cookie: `streamweaver-session=${cookie}` },
  }));

  assert.equal(response.status, 307);
  const location = response.headers.get('location');
  assert.ok(location);
  const target = new URL(location!);
  assert.equal(target.pathname, '/api/ai/image/library');
  assert.equal(target.searchParams.get('tenantId'), 'tenant-private-gallery');
  assert.equal(target.searchParams.get('scope'), 'private');
});

test('private gallery shortcut sends unsigned browsers to login', async () => {
  const { GET } = await import('../src/app/private-gallery/route');
  const response = await GET(new NextRequest('https://streamweaver.test/private-gallery'));
  assert.equal(response.status, 307);
  assert.equal(new URL(response.headers.get('location')!).pathname, '/login');
});

test('app shell and private chat both expose the private gallery shortcut', () => {
  const shell = readFileSync(new URL('../src/components/layout/app-shell.tsx', import.meta.url), 'utf8');
  const privateChat = readFileSync(new URL('../src/app/(app)/private-chat/page.tsx', import.meta.url), 'utf8');

  assert.match(shell, /href="\/private-gallery"/);
  assert.match(shell, /Open private gallery/);
  assert.match(privateChat, /href="\/private-gallery"/);
  assert.match(privateChat, /Open private gallery/);
});
