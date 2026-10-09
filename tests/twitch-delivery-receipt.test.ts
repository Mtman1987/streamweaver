import test from 'node:test';
import assert from 'node:assert/strict';
import { assertTwitchDeliveryReceipt, isNonRestartableTwitchDeliveryFailure } from '../src/services/twitch-delivery-receipt';
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

test('authorization and wake errors survive HTTP delivery without changing sender context', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      assert.equal(body.as, 'bot');
      assert.equal(body.targetChannel, 'captain_a');
      assert.equal(body.tenantId, 'a');
      return new Response(JSON.stringify({ success: false, skipped: true,
        error: 'Shared bot is asleep or this channel is not authorized. Broadcaster/mod: spmt wake on.' }), { status: 409 });
    };
    await assert.rejects(sendChatMessage('fixture', 'bot', 'captain_a', 'a'), (error: unknown) => {
      assert.equal(isNonRestartableTwitchDeliveryFailure(error), true);
      return true;
    });
    const transportError = new Error('fetch failed');
    globalThis.fetch = async () => { throw transportError; };
    await assert.rejects(sendChatMessage('fixture', 'bot', 'captain_a', 'a'), (error: unknown) => {
      assert.equal(error, transportError);
      assert.equal(isNonRestartableTwitchDeliveryFailure(error), false);
      return true;
    });
  } finally { globalThis.fetch = original; }
});
test('delivery classifier preserves repair categories and transient recovery', () => {
  for (const message of ['Twitch send skipped: shared-bot-asleep-or-channel-not-authorized',
    'Shared chat source-only send failed (permission)',
    'Shared chat source-only send skipped (sender-unavailable)']) {
    assert.equal(isNonRestartableTwitchDeliveryFailure(new Error(message)), true);
  }
  for (const message of ['fetch failed', 'Failed to send message: Service Unavailable',
    'Shared chat source-only send failed (timeout)']) {
    assert.equal(isNonRestartableTwitchDeliveryFailure(new Error(message)), false);
  }
});
