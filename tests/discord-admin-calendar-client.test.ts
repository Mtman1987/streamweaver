import test from 'node:test';
import assert from 'node:assert/strict';

test('Admin Calendar client requires DiscordStreamHub to confirm the write', async () => {
  const originalFetch = global.fetch;
  const originalUrl = process.env.DISCORD_STREAM_HUB_URL;
  const originalSecret = process.env.DSH_SERVICE_SECRET;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  try {
    process.env.DISCORD_STREAM_HUB_URL = 'https://dsh.test';
    process.env.DSH_SERVICE_SECRET = 'shared-secret';
    global.fetch = (async (input, init) => {
      calls.push({ url: String(input), init });
      return new Response(JSON.stringify({ success: true, message: 'Calendar refreshed.' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    const { createDiscordStreamHubAdminCalendarEvent } = await import('../src/services/discord-stream-hub');
    const result = await createDiscordStreamHubAdminCalendarEvent({
      serverId: 'guild-1',
      userId: 'user-1',
      missionName: 'Recording',
      missionDescription: 'Added through Discord.',
      missionDate: '2026-09-01',
      missionTime: '03:00',
      missionTimeZone: 'UTC',
    });

    assert.equal(result.success, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://dsh.test/api/internal/calendar/add-mission');
    assert.equal((calls[0].init?.headers as Record<string, string>).Authorization, 'Bearer shared-secret');
    assert.deepEqual(JSON.parse(String(calls[0].init?.body)), {
      serverId: 'guild-1',
      userId: 'user-1',
      missionName: 'Recording',
      missionDescription: 'Added through Discord.',
      missionDate: '2026-09-01',
      missionTime: '03:00',
      missionTimeZone: 'UTC',
    });
  } finally {
    global.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.DISCORD_STREAM_HUB_URL;
    else process.env.DISCORD_STREAM_HUB_URL = originalUrl;
    if (originalSecret === undefined) delete process.env.DSH_SERVICE_SECRET;
    else process.env.DSH_SERVICE_SECRET = originalSecret;
  }
});
