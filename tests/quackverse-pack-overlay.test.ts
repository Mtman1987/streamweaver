import test from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';

test('Quackverse pack opens broadcast to the source StreamWeaver tenant pack overlay', async () => {
  const originalSecret = process.env.BOT_SECRET_KEY;
  const originalFetch = global.fetch;
  process.env.BOT_SECRET_KEY = 'test-streamweaver-overlay-secret';
  let forwarded: any = null;
  global.fetch = (async (_input, init) => {
    forwarded = JSON.parse(String(init?.body || '{}'));
    return new Response(JSON.stringify({ success: true, delivered: 2 }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;

  try {
    const { POST } = await import('../src/app/api/quackverse/pack-overlay/route');
    const response = await POST(new NextRequest('http://localhost/api/quackverse/pack-overlay', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer test-streamweaver-overlay-secret',
      },
      body: JSON.stringify({
        tenantId: '47145728',
        username: 'packviewer',
        setName: 'Quackverse',
        pack: [{
          id: 'qv-1',
          number: '1',
          name: 'Space Duck',
          rarity: 'Rare',
          setCode: 'QV',
          imageUrl: 'https://chat-tag.test/cards/space-duck.png',
        }],
      }),
    }));

    assert.equal(response.status, 200);
    assert.equal(forwarded.tenantId, '47145728');
    assert.deepEqual(forwarded.messages.map((entry: any) => entry.type), [
      'pokemon-pack-opened',
      'quackverse-pack-opened',
    ]);
    assert.equal(forwarded.messages[0].payload.username, 'packviewer');
    assert.equal(forwarded.messages[0].payload.pack[0].imageUrl, 'https://chat-tag.test/cards/space-duck.png');
    assert.equal((await response.json()).delivered, 2);
  } finally {
    if (originalSecret === undefined) delete process.env.BOT_SECRET_KEY;
    else process.env.BOT_SECRET_KEY = originalSecret;
    global.fetch = originalFetch;
  }
});
