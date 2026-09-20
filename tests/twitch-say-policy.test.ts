import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ATHENA_TWITCH_TTS_VOICE,
  getTwitchBotTtsVoice,
  shouldQueueTwitchSay,
} from '../src/services/twitch-say-policy';

test('ordinary viewer messages remain eligible for Twitch say TTS', () => {
  assert.equal(shouldQueueTwitchSay({
    tenantId: 'mtman1987',
    username: 'viewer',
    isCommand: false,
    isBotMessage: false,
    isKnownAutomationBotMessage: false,
  }), true);
});

test('AthenaBot87 and StellaBot87 messages are always spoken from Twitch chat', () => {
  assert.equal(shouldQueueTwitchSay({
    tenantId: 'mtman1987',
    username: 'AthenaBot87',
    isCommand: false,
    isBotMessage: true,
    isKnownAutomationBotMessage: false,
  }), true);
  assert.equal(shouldQueueTwitchSay({
    tenantId: 'spacemountainlive',
    username: 'StellaBot87',
    isCommand: false,
    isBotMessage: true,
    isKnownAutomationBotMessage: false,
  }), true);
});

test('other bot messages and commands remain blocked from Twitch say TTS', () => {
  assert.equal(shouldQueueTwitchSay({
    tenantId: 'spacemountainlive',
    username: 'StreamElements',
    isCommand: false,
    isBotMessage: false,
    isKnownAutomationBotMessage: true,
  }), false);
  assert.equal(shouldQueueTwitchSay({
    tenantId: 'spacemountainlive',
    username: 'StellaBot87',
    isCommand: true,
    isBotMessage: true,
    isKnownAutomationBotMessage: false,
  }), false);
});

test('Athena keeps her canonical voice while Stella uses her configured voice', () => {
  assert.equal(getTwitchBotTtsVoice('AthenaBot87'), ATHENA_TWITCH_TTS_VOICE);
  assert.equal(getTwitchBotTtsVoice('StellaBot87'), undefined);
});
