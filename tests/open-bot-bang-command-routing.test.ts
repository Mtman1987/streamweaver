import test from 'node:test';
import assert from 'node:assert/strict';
import { detectOpenBotCommand, detectOpenBotCommandWithAi } from '../src/services/open-bot-commands';

test('explicit Discord bang commands bypass open-command routing', async () => {
  let aiCalls = 0;
  const aiResponder = async () => {
    aiCalls += 1;
    return 'chat-tag-leaderboard';
  };

  assert.equal(detectOpenBotCommand('!points'), null);
  assert.equal(detectOpenBotCommand('!leader'), null);
  assert.equal(detectOpenBotCommand('!leaderboard'), null);
  assert.equal(await detectOpenBotCommandWithAi('!points', 'tenant-a', aiResponder as any), null);
  assert.equal(await detectOpenBotCommandWithAi('!leader', 'tenant-a', aiResponder as any), null);
  assert.equal(await detectOpenBotCommandWithAi('!leaderboard', 'tenant-a', aiResponder as any), null);
  assert.equal(aiCalls, 0);
});

test('natural-language leaderboard requests still use open-command routing', async () => {
  assert.equal(detectOpenBotCommand('show the ChatTag leaderboard'), 'chat-tag-leaderboard');
});
