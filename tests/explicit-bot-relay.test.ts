import test from 'node:test';
import assert from 'node:assert/strict';
import { deliverExplicitBotRelay } from '../src/services/explicit-bot-relay';

test('explicit human relay uses the target tenant bot in its live channel without consulting botshare', async () => {
  const sent: Array<{ message: string; as: string; channel?: string; tenantId?: string }> = [];
  const result = await deliverExplicitBotRelay({
    sourceTenantId: 'tenant-athena',
    sourceUserName: 'Commander',
    speaker: {
      stableId: '94371378:athena',
      currentName: 'Athena',
      aliases: ['Athenabot87'],
    },
    targetTenantId: 'tenant-reaper',
    target: {
      stableId: 'unknown:reaper',
      currentName: 'Reaper',
      aliases: ['Reaper'],
    },
    relayMessage: 'let Neph know the Commander will be ready to play in 10 minutes',
  }, {
    getBroadcasterChannel: async () => 'nephalem2',
    lookupLiveTarget: async () => ({ isLive: true }),
    generateRelayText: async () => 'Hey boss, Athena wanted me to let you know the Commander will be ready in 10 minutes to play.',
    sendTwitch: async (message, as, channel, tenantId) => {
      sent.push({ message, as, channel, tenantId });
    },
    findDiscordLastSeen: async () => {
      throw new Error('Discord fallback must not run for a live target');
    },
    readTargetDiscordConfig: async () => {
      throw new Error('DM fallback must not run for a live target');
    },
    sendDiscord: async () => {
      throw new Error('Discord send must not run for a live target');
    },
  });

  assert.equal(result.delivered, true);
  assert.equal(result.mode, 'live');
  assert.equal(result.targetChannel, 'nephalem2');
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0], {
    message: 'Hey boss, Athena wanted me to let you know the Commander will be ready in 10 minutes to play.',
    as: 'bot',
    channel: 'nephalem2',
    tenantId: 'tenant-reaper',
  });
});
