import test from 'node:test';
import assert from 'node:assert/strict';

import { registerHandledDiscordMessage } from '../src/services/discord-message-dedupe';

test('discord dedupe suppresses the same message id in the same channel', () => {
  const message = {
    messageId: `msg-${Date.now()}-1`,
    channelId: 'channel-a',
  };

  assert.equal(registerHandledDiscordMessage(message), true);
  assert.equal(registerHandledDiscordMessage(message), false);
});

test('discord dedupe suppresses webhook and poller copies of the same message via content signature', () => {
  const createdAt = new Date().toISOString();
  const webhookCopy = {
    channelId: 'channel-b',
    userId: 'user-1',
    username: 'mtman1987',
    content: 'hello from discordstreamhub',
    createdAt,
  };
  const pollerCopy = {
    messageId: `msg-${Date.now()}-2`,
    channelId: 'channel-b',
    userId: 'user-1',
    username: 'mtman1987',
    content: 'hello   from   discordstreamhub',
    createdAt,
  };

  assert.equal(registerHandledDiscordMessage(webhookCopy), true);
  assert.equal(registerHandledDiscordMessage(pollerCopy), false);
});
