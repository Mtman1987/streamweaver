import test from 'node:test';
import assert from 'node:assert/strict';
import { assertTwitchDeliveryReceipt } from '../src/services/twitch-delivery-receipt';
import { sendChatMessage } from '../src/services/twitch';

test('delivery requires explicit success with no skipped flag', () => {
  assert.doesNotThrow(() => assertTwitchDeliveryReceipt({ success: true }));
  for (const receipt of [null, {}, { success: false }, { success: true, skipped: true, reason: 'community-bot-read-only' }]) {
    assert.throws(() => assertTwitchDeliveryReceipt(receipt));
  }
});
test('sendChatMessage rejects false HTTP-200 success without posting externally', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ success: true, skipped: true,
      reason: 'shared-bot-asleep-or-channel-not-authorized' }), { status: 200 });
    await assert.rejects(sendChatMessage('test fixture', 'bot', 'captain_a', 'a'));
    globalThis.fetch = async () => new Response(JSON.stringify({ success: true }), { status: 200 });
    await assert.doesNotReject(sendChatMessage('test fixture', 'bot', 'captain_a', 'a'));
  } finally { globalThis.fetch = original; }
});
