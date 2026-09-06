import test from 'node:test';
import assert from 'node:assert/strict';
import { executeHearMeOutBotAction } from '../src/services/hearmeout-actions';

test('uses HearMeOut shared keys and retries only explicit credential rejection', async () => {
  const originalFetch = globalThis.fetch;
  const keys = ['HEARMEOUT_SERVICE_SECRET', 'BOT_SECRET_KEY', 'STREAMWEAVER_SECRET'];
  const saved = keys.map(key => process.env[key]);
  const sent: string[] = [];
  try {
    process.env.HEARMEOUT_SERVICE_SECRET = 'old-hmo';
    process.env.BOT_SECRET_KEY = 'shared-bot';
    process.env.STREAMWEAVER_SECRET = 'wrong-service';
    globalThis.fetch = (async (_url: any, init: any) => {
      sent.push(new Headers(init.headers).get('authorization')!);
      return sent.length === 1 ? Response.json({ error: 'Unauthorized' }, { status: 401 }) : Response.json({ success: true });
    }) as typeof fetch;
    await executeHearMeOutBotAction({ action: 'hmo.media.state.read', tenantId: 'owner' });
    assert.deepEqual(sent, ['Bearer old-hmo', 'Bearer shared-bot']);
    sent.length = 0;
    globalThis.fetch = (async (_url: any, init: any) => {
      sent.push(new Headers(init.headers).get('authorization')!);
      return Response.json({ error: 'unavailable' }, { status: 503 });
    }) as typeof fetch;
    await assert.rejects(executeHearMeOutBotAction({ action: 'hmo.media.request', tenantId: 'owner', query: 'song' }));
    assert.equal(sent.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
    keys.forEach((key, index) => { if (saved[index] === undefined) delete process.env[key]; else process.env[key] = saved[index]; });
  }
});
