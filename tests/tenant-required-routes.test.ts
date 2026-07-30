import test from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';

function jsonRequest(url: string, body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

test('tenant-owned routes reject requests without a tenant session or service credential', async () => {
  const originalEnforcement = process.env.MOUNTAINVIEW_BRIDGE_ENFORCE_SECRET;
  process.env.MOUNTAINVIEW_BRIDGE_ENFORCE_SECRET = 'true';
  try {
    const [
      aiMemory,
      aiShoutout,
      image,
      privateChat,
      tts,
      ttsCurrent,
      gamble,
      classicGamble,
      welcome,
      leaderboard,
      clearMemory,
      mountainVoice,
      mountainImage,
      genSettings,
      discordChannels,
      chatters,
      partners,
      checkinSource,
    ] = await Promise.all([
      import('../src/app/api/ai/chat-with-memory/route'),
      import('../src/app/api/ai/shoutout/route'),
      import('../src/app/api/ai/image/route'),
      import('../src/app/api/private-chat/respond/route'),
      import('../src/app/api/tts/route'),
      import('../src/app/api/tts/current/route'),
      import('../src/app/api/gamble/route'),
      import('../src/app/api/classic-gamble/route'),
      import('../src/app/api/welcome-wagon/route'),
      import('../src/app/api/leaderboard/route'),
      import('../src/app/api/ai/clear-memory/route'),
      import('../src/app/api/mountainview/voice-commander/route'),
      import('../src/app/api/mountainview/image-relay/route'),
      import('../src/app/api/gen-settings/route'),
      import('../src/app/api/discord/channels/route'),
      import('../src/app/api/chat/chatters/route'),
      import('../src/app/api/partners/route'),
      import('../src/app/api/checkins/source/route'),
    ]);

    const checks: Array<[string, Promise<Response>]> = [
      ['AI memory', aiMemory.POST(jsonRequest('http://localhost/api/ai/chat-with-memory', { username: 'viewer', message: 'hello' }))],
      ['AI shoutout', aiShoutout.POST(jsonRequest('http://localhost/api/ai/shoutout', { username: 'viewer' }))],
      ['image generation', image.POST(jsonRequest('http://localhost/api/ai/image', { prompt: 'a mountain' }))],
      ['private chat', privateChat.POST(jsonRequest('http://localhost/api/private-chat/respond', { username: 'viewer', message: 'hello' }))],
      ['TTS generation', tts.POST(jsonRequest('http://localhost/api/tts', { text: 'hello' }))],
      ['TTS queue mutation', ttsCurrent.POST(jsonRequest('http://localhost/api/tts/current?tenant=tenant-a', { audioUrl: 'data:audio/mpeg;base64,AA==' }))],
      ['gamble', gamble.POST(jsonRequest('http://localhost/api/gamble', { command: 'roll', user: 'viewer', wager: 10 }))],
      ['classic gamble', classicGamble.POST(jsonRequest('http://localhost/api/classic-gamble', { action: 'get-settings' }))],
      ['welcome settings', welcome.POST(jsonRequest('http://localhost/api/welcome-wagon', { username: 'viewer', action: 'add' }))],
      ['leaderboard', leaderboard.GET(new NextRequest('http://localhost/api/leaderboard'))],
      ['AI memory clearing', clearMemory.POST(jsonRequest('http://localhost/api/ai/clear-memory', {}))],
      ['MountainView voice bridge', mountainVoice.POST(jsonRequest('http://localhost/api/mountainview/voice-commander', { transcript: 'hello', tenantId: 'tenant-a' }, { 'x-mountainview-bridge': '1' }))],
      ['MountainView image bridge', mountainImage.POST(jsonRequest('http://localhost/api/mountainview/image-relay', { prompt: 'hello', tenantId: 'tenant-a' }, { 'x-mountainview-bridge': '1' }))],
      ['generation settings', genSettings.GET(new NextRequest('http://localhost/api/gen-settings?tenantId=tenant-a'))],
      ['Discord channels', discordChannels.GET(new NextRequest('http://localhost/api/discord/channels?tenantId=tenant-a'))],
      ['Twitch chatters', chatters.GET(new NextRequest('http://localhost/api/chat/chatters?tenant=tenant-a'))],
      ['partner source', partners.GET(new NextRequest('http://localhost/api/partners?tenant=tenant-a&guildId=guild&roleName=Partners'))],
      ['check-in source', checkinSource.GET(new NextRequest('http://localhost/api/checkins/source?tenant=tenant-a&kind=crew'))],
    ];

    for (const [name, responsePromise] of checks) {
      const response = await responsePromise;
      assert.equal(response.status, 401, name + ' should reject missing authentication');
    }
  } finally {
    if (originalEnforcement === undefined) delete process.env.MOUNTAINVIEW_BRIDGE_ENFORCE_SECRET;
    else process.env.MOUNTAINVIEW_BRIDGE_ENFORCE_SECRET = originalEnforcement;
  }
});

test('MountainView bridge authentication requires both the marker and its scoped secret', async () => {
  const original = process.env.MOUNTAINVIEW_STREAMWEAVER_SECRET;
  const originalEnforcement = process.env.MOUNTAINVIEW_BRIDGE_ENFORCE_SECRET;
  process.env.MOUNTAINVIEW_STREAMWEAVER_SECRET = 'test-mountainview-streamweaver-secret';
  process.env.MOUNTAINVIEW_BRIDGE_ENFORCE_SECRET = 'true';
  try {
    const { hasMountainViewBridgeAccess } = await import('../src/lib/internal-service-auth');
    const missingSecret = new NextRequest('http://localhost/api/tts', {
      headers: { 'x-mountainview-bridge': '1' },
    });
    const valid = new NextRequest('http://localhost/api/tts', {
      headers: {
        'x-mountainview-bridge': '1',
        Authorization: 'Bearer test-mountainview-streamweaver-secret',
      },
    });
    assert.equal(hasMountainViewBridgeAccess(missingSecret), false);
    assert.equal(hasMountainViewBridgeAccess(valid), true);
  } finally {
    if (original === undefined) delete process.env.MOUNTAINVIEW_STREAMWEAVER_SECRET;
    else process.env.MOUNTAINVIEW_STREAMWEAVER_SECRET = original;
    if (originalEnforcement === undefined) delete process.env.MOUNTAINVIEW_BRIDGE_ENFORCE_SECRET;
    else process.env.MOUNTAINVIEW_BRIDGE_ENFORCE_SECRET = originalEnforcement;
  }
});

test('public TTS readers advance with their own cursor without consuming another reader queue', async () => {
  const original = process.env.BOT_SECRET_KEY;
  process.env.BOT_SECRET_KEY = 'test-streamweaver-internal-secret';
  try {
    const ttsCurrent = await import('../src/app/api/tts/current/route');
    const tenant = 'tts-cursor-isolation-test';
    const headers = { Authorization: 'Bearer test-streamweaver-internal-secret' };
    await ttsCurrent.POST(jsonRequest(`http://localhost/api/tts/current?tenant=${tenant}`, { audioUrl: 'https://example.test/one.mp3' }, headers));
    await ttsCurrent.POST(jsonRequest(`http://localhost/api/tts/current?tenant=${tenant}`, { audioUrl: 'https://example.test/two.mp3' }, headers));

    const firstResponse = await ttsCurrent.GET(new NextRequest(`http://localhost/api/tts/current?next=1&tenant=${tenant}`));
    const first = await firstResponse.json();
    assert.equal(first.audioUrl, 'https://example.test/one.mp3');
    assert.ok(first.cursor);

    const independentReaderResponse = await ttsCurrent.GET(new NextRequest(`http://localhost/api/tts/current?next=1&tenant=${tenant}`));
    const independentReader = await independentReaderResponse.json();
    assert.equal(independentReader.audioUrl, 'https://example.test/one.mp3');
    assert.equal(independentReader.cursor, first.cursor);

    const secondResponse = await ttsCurrent.GET(
      new NextRequest(`http://localhost/api/tts/current?next=1&tenant=${tenant}&after=${encodeURIComponent(first.cursor)}`)
    );
    const second = await secondResponse.json();
    assert.equal(second.audioUrl, 'https://example.test/two.mp3');
    assert.notEqual(second.cursor, first.cursor);
  } finally {
    if (original === undefined) delete process.env.BOT_SECRET_KEY;
    else process.env.BOT_SECRET_KEY = original;
  }
});
