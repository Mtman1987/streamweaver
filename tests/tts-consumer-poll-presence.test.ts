import test from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';

import { GET as getCurrentTts } from '../src/app/api/tts/current/route';
import { hasActiveTtsConsumer } from '../src/services/tts-consumer-presence';

test('an OBS queue poll renews the tenant overlay presence automatically', async () => {
  const tenantId = `obs-poll-${Date.now()}`;
  assert.equal(hasActiveTtsConsumer(tenantId), false);

  const response = await getCurrentTts(
    new NextRequest(`http://localhost/api/tts/current?next=1&tenant=${tenantId}`),
  );

  assert.equal(response.status, 200);
  assert.equal(hasActiveTtsConsumer(tenantId), true);
});
