import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deliverExplicitBotRelay,
  normalizeExplicitBotRelayMessage,
} from '../src/services/explicit-bot-relay';
import { detectBotRelayRequestWithAi } from '../src/services/bot-relay';

const REAPER = {
  stableId: 'unknown:reaper',
  currentName: 'Reaper',
  aliases: ['Reaper'],
};

test('legacy public transport relay detection defers known bots to AthenaOS but preserves direct humans', async () => {
  const input = {
    message: 'Athena, tell Reaper the Commander will be ready in 10 minutes.',
    speakerName: 'Athena',
    targets: [REAPER],
    tenantId: 'tenant-athena',
    platform: 'discord' as const,
  };

  assert.deepEqual(await detectBotRelayRequestWithAi(input), { matched: false });

  const directHuman = await detectBotRelayRequestWithAi({
    ...input,
    message: 'Athena, tell SomeViewer that the game starts in 10 minutes.',
  });
  assert.equal(directHuman.matched, true);
  assert.equal(directHuman.targetName, 'SomeViewer');
  assert.match(directHuman.relayMessage || '', /game starts in 10 minutes/i);

  const rollbackOnly = await detectBotRelayRequestWithAi({
    ...input,
    legacyTransportExecution: true,
  });
  assert.equal(rollbackOnly.matched, true);
  assert.equal(rollbackOnly.targetName, 'Reaper');
});

test('nested relay wording is normalized for the target streamer', () => {
  assert.equal(
    normalizeExplicitBotRelayMessage('to let Neph know that the Commander will be ready in 10 minutes'),
    'the Commander will be ready in 10 minutes',
  );
});

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
    target: REAPER,
    relayMessage: 'let Neph know the Commander will be ready to play in 10 minutes',
  }, {
    getBroadcasterChannel: async () => 'nephalem2',
    lookupLiveTarget: async () => ({ isLive: true }),
    generateRelayText: async (input) => {
      assert.equal(input.relayMessage, 'the Commander will be ready to play in 10 minutes');
      assert.equal(input.targetAudienceName, 'nephalem2');
      return 'Hey boss, Athena wanted me to let you know the Commander will be ready in 10 minutes to play.';
    },
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
