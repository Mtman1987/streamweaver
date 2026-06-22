import test from 'node:test';
import assert from 'node:assert/strict';

import { detectBotRelayRequest } from '../src/services/bot-relay';

const reaper = {
  stableId: 'tenant2:reaper',
  currentName: 'Reaper',
  aliases: ['reaperbot'],
  previousNames: [],
} as any;

test('detects relay requests addressed to another bot by bot name', () => {
  const result = detectBotRelayRequest({
    message: 'Athena can you tell Reaper I am trying to talk to the dark lord',
    speakerName: 'Athena',
    targets: [reaper],
  });

  assert.equal(result.matched, true);
  assert.equal(result.target?.currentName, 'Reaper');
  assert.equal(result.relayMessage, 'I am trying to talk to the dark lord');
});

test('detects relay requests addressed to a streamer username', () => {
  const result = detectBotRelayRequest({
    message: 'Athena can you tell mtman1987 to come play halo with me',
    speakerName: 'Athena',
    targets: [reaper],
  });

  assert.equal(result.matched, true);
  assert.equal(result.targetName, 'mtman1987');
  assert.equal(result.relayMessage, 'to come play halo with me');
});

test('keeps quoted relay content available for exact delivery', () => {
  const result = detectBotRelayRequest({
    message: 'Athena tell mothermayrien that I said "heello"',
    speakerName: 'Athena',
    targets: [reaper],
  });

  assert.equal(result.matched, true);
  assert.equal(result.targetName, 'mothermayrien');
  assert.equal(result.relayMessage, 'I said "heello"');
});
