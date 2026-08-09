from pathlib import Path


def replace(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    if new in text:
        return
    if old not in text:
        raise SystemExit(f'Expected block not found in {path}')
    file.write_text(text.replace(old, new))


replace(
    'tests/discord-points-commands.test.ts',
    "    assert.match(String(embed.thumbnail.url), /StreamWeaver\\.png$/);",
    "    assert.match(String(embed.thumbnail.url), /space-logo-main\\.png$/);",
)

replace(
    'tests/discord-structured-replies.test.ts',
    "        assert.match(body.avatar_url, /\\/StreamWeaver\\.png$/);",
    "        assert.match(body.avatar_url, /\\/assets\\/space-logo-main\\.png$/);",
)

replace(
    'tests/mt-support-report.test.ts',
'''test('detectMtFixItIntent supports command and voice alias forms', () => {
  assert.deepEqual(detectMtFixItIntent('!mtfixit obs crashed'), { matched: true, description: 'obs crashed' });
  assert.deepEqual(detectMtFixItIntent('mt fix it alerts are stuck'), { matched: true, description: 'alerts are stuck' });
  assert.deepEqual(detectMtFixItIntent('hello there'), { matched: false, description: '' });
});

test('pending support requests can be tracked per user context', () => {
  const context = { platform: 'twitch' as const, tenantId: 'tenant-1', username: 'MtUser', channelId: 'chan-1' };
  beginPendingMtSupportRequest(context);
  assert.equal(hasPendingMtSupportRequest(context), true);
  assert.equal(consumePendingMtSupportRequest(context), true);
  assert.equal(hasPendingMtSupportRequest(context), false);
});''',
'''test('retired StreamWeaver mtfixit ingress never claims commands now owned by DiscordStreamHub', () => {
  assert.deepEqual(detectMtFixItIntent('!mtfixit obs crashed'), { matched: false, description: '' });
  assert.deepEqual(detectMtFixItIntent('mt fix it alerts are stuck'), { matched: false, description: '' });
  assert.deepEqual(detectMtFixItIntent('hello there'), { matched: false, description: '' });
});

test('retired StreamWeaver mtfixit ingress does not keep pending support state', () => {
  const context = { platform: 'twitch' as const, tenantId: 'tenant-1', username: 'MtUser', channelId: 'chan-1' };
  beginPendingMtSupportRequest(context);
  assert.equal(hasPendingMtSupportRequest(context), false);
  assert.equal(consumePendingMtSupportRequest(context), false);
  assert.equal(hasPendingMtSupportRequest(context), false);
});''',
)

carousel = Path('tests/private-image-carousel.test.ts')
text = carousel.read_text()
if "const originalControlSecret = process.env.PRIVATE_DM_CONTROL_SECRET;" not in text:
    text = text.replace(
        "  process.env.PERSIST_ROOT = runtimeRoot;\n",
        "  process.env.PERSIST_ROOT = runtimeRoot;\n  const originalControlSecret = process.env.PRIVATE_DM_CONTROL_SECRET;\n  process.env.PRIVATE_DM_CONTROL_SECRET = 'test-private-dm-control-secret';\n",
    )
text = text.replace(
    "    assert.deepEqual(seen, [images[1], null]);\n    assert.deepEqual(message.embeds[0].fields, [{ name: 'controls' }]);",
    "    assert.deepEqual(seen, [images[1], images[1]]);\n    assert.equal(message.embeds[0].fields.some((field: any) => String(field.value || '').includes('[🔄]')), true);",
)
text = text.replace(
    "    assert.deepEqual(seen, [images[0], images[1], null]);",
    "    assert.deepEqual(seen, [images[0], images[0], images[1], images[1]]);",
)
if "if (originalControlSecret === undefined)" not in text:
    text = text.replace(
        "  } finally {\n    await rm(runtimeRoot, { recursive: true, force: true });\n",
        "  } finally {\n    if (originalControlSecret === undefined) delete process.env.PRIVATE_DM_CONTROL_SECRET;\n    else process.env.PRIVATE_DM_CONTROL_SECRET = originalControlSecret;\n    await rm(runtimeRoot, { recursive: true, force: true });\n",
    )
carousel.write_text(text)

session = Path('tests/signed-session.test.ts')
text = session.read_text()
old = '''test('middleware passes signed session candidates to the Node page guard', async () => {
  const request = new NextRequest('https://streamweaver-new.fly.dev/dashboard', {
    headers: { cookie: 'streamweaver-session=payload.signature' },
  });
  const response = await middleware(request);
  assert.equal(response.headers.get('x-middleware-next'), '1');
});'''
new = '''test('middleware accepts a verified SPMT identity and forwards identity headers to the Node page guard', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => Response.json({
    id: 'spmt-user-a',
    username: 'owner',
    displayName: 'Owner',
    isAdmin: true,
  });
  try {
    const request = new NextRequest('https://streamweaver-new.fly.dev/dashboard', {
      headers: { cookie: 'streamweaver-spmt-token=provider-token' },
    });
    const response = await middleware(request);
    assert.equal(response.headers.get('x-middleware-next'), '1');
    assert.equal(response.headers.get('x-middleware-request-x-spmt-user-id'), 'spmt-user-a');
    assert.equal(response.headers.get('x-middleware-request-x-spmt-is-admin'), '1');
  } finally {
    global.fetch = originalFetch;
  }
});'''
if new not in text:
    if old not in text:
        raise SystemExit('Expected signed-session page-guard test not found')
    text = text.replace(old, new)

old = '''test('middleware limits SPMT service access to the feed and dispatch routes', async () => {
  const original = process.env.SPMT_SYSTEM_KEY;
  process.env.SPMT_SYSTEM_KEY = 'test-spmt-system-key';
  try {
    for (const pathname of ['/api/shared-chat/spmt-feed', '/api/shared-chat/spmt-dispatch', '/api/shared-chat/spmt-operator']) {
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
});'''
new = '''test('middleware passes SPMT machine routes through to route-level service authentication', async () => {
  for (const pathname of ['/api/shared-chat/spmt-feed', '/api/shared-chat/spmt-dispatch', '/api/shared-chat/spmt-operator']) {
    const allowed = await middleware(new NextRequest(`https://streamweaver-new.fly.dev${pathname}`, {
      headers: { 'x-spmt-key': 'test-spmt-system-key' },
    }));
    assert.equal(allowed.headers.get('x-middleware-next'), '1');
  }

  const wrongKeyStillReachesRouteGuard = await middleware(new NextRequest(
    'https://streamweaver-new.fly.dev/api/shared-chat/spmt-dispatch',
    { headers: { 'x-spmt-key': 'wrong' } },
  ));
  assert.equal(wrongKeyStillReachesRouteGuard.headers.get('x-middleware-next'), '1');
});'''
if new not in text:
    if old not in text:
        raise SystemExit('Expected signed-session machine-route test not found')
    text = text.replace(old, new)
session.write_text(text)
