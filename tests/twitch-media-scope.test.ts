import assert from 'node:assert/strict';
import test from 'node:test';
import { executeHearMeOutBotAction } from '../src/services/hearmeout-actions';
process.env.HEARMEOUT_SERVICE_SECRET = 'test-service-key';
test('Twitch media reroutes legacy shared session IDs to tenant music and rejects movies', async () => {
  const original = global.fetch;
  const sent: any[] = [];
  global.fetch = async (_url, init) => { sent.push(JSON.parse(String(init?.body))); return Response.json({ success: true }); };
  try {
    for (const tenantId of ['123', '456']) await executeHearMeOutBotAction({ action: 'hmo.media.control', tenantId, streamMode: 'twitch', sessionId: 'discord-music-room', control: 'next' });
    assert.equal(sent[0].sessionId, 'watch-twitch-123-music');
    assert.equal(sent[1].sessionId, 'watch-twitch-456-music');
    assert.equal(sent[0].roomId, undefined);
    await assert.rejects(executeHearMeOutBotAction({ action: 'hmo.media.request', tenantId: '123', streamMode: 'twitch', sessionId: 'discord-watch-room', query: 'movie' }), /disabled/);
    assert.equal(sent.length, 2);
  } finally { global.fetch = original; }
});
