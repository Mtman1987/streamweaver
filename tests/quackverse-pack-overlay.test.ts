import test from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';

test('Quackverse pack opens broadcast to the source StreamWeaver tenant pack overlay', async () => {
  const originalSecret = process.env.BOT_SECRET_KEY;
  const originalBroadcast = (global as any).broadcast;
  process.env.BOT_SECRET_KEY = 'test-streamweaver-overlay-secret';
  const broadcasts: Array<{ message: any; tenantId?: string }> = [];
  (global as any).broadcast = (message: any, tenantId?: string) => {
    broadcasts.push({ message, tenantId });
  };

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
    assert.equal(broadcasts.length, 2);
    assert.deepEqual(broadcasts.map((entry) => entry.message.type), [
      'pokemon-pack-opened',
      'quackverse-pack-opened',
    ]);
    assert.ok(broadcasts.every((entry) => entry.tenantId === '47145728'));
    assert.equal(broadcasts[0].message.payload.username, 'packviewer');
    assert.equal(broadcasts[0].message.payload.pack[0].imageUrl, 'https://chat-tag.test/cards/space-duck.png');
  } finally {
    if (originalSecret === undefined) delete process.env.BOT_SECRET_KEY;
    else process.env.BOT_SECRET_KEY = originalSecret;
    (global as any).broadcast = originalBroadcast;
  }
});
