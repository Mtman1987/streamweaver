import test from 'node:test';
import assert from 'node:assert/strict';
import type { AthenaRequest } from '../src/services/athena-contract';
import {
  decideAthenaAction,
  executeAthenaDecision,
} from '../src/services/athena-tools';

function request(overrides: Partial<AthenaRequest>): AthenaRequest {
  return {
    tenantId: 'athena-tool-test',
    message: 'hello Athena',
    actor: { username: 'captain', isOwner: true },
    location: {
      app: 'streamweaver',
      surface: 'twitch-chat',
      channelName: 'captain-channel',
      live: true,
    },
    visibility: 'public',
    executeTools: true,
    ...overrides,
  };
}

test('explicit Twitch commands are handed to the transport command layer', async () => {
  const decision = await decideAthenaAction(request({ message: '!points' }));
  assert.equal(decision.mode, 'command');
  assert.equal(decision.toolId, 'transport.command');
  assert.equal(decision.command, '!points');
});

test('live app-state questions choose a safe read tool', async () => {
  const decision = await decideAthenaAction(request({
    message: "who's live?",
    location: {
      app: 'streamweaver',
      surface: 'discord-channel',
      guildId: 'guild-1',
      channelId: 'channel-1',
      live: true,
    },
  }));
  assert.equal(decision.mode, 'tool');
  assert.equal(decision.toolId, 'community.live-members');
  assert.equal(decision.risk, 'read');
});

test('private image requests use the image tool and can be planned without executing', async () => {
  const privateRequest = request({
    message: 'create an image of a red moon over a station',
    visibility: 'private',
    executeTools: false,
    location: {
      app: 'streamweaver',
      surface: 'streamweaver-private',
      live: false,
      layout: 'private-chat',
    },
  });
  const decision = await decideAthenaAction(privateRequest);
  assert.equal(decision.mode, 'tool');
  assert.equal(decision.toolId, 'image.generate');
  assert.equal(decision.arguments?.prompt, 'a red moon over a station');

  const outcome = await executeAthenaDecision(privateRequest, decision);
  assert.equal(outcome.decision.executed, false);
  assert.match(outcome.response || '', /execution is disabled/i);
});
