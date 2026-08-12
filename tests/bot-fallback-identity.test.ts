import assert from 'node:assert/strict';
import test from 'node:test';
import { applyBotTransportIdentity, type BotSettings } from '../src/lib/bot-settings-store';
import { COMMUNITY_BOT_NAME } from '../src/lib/bot-personality-defaults';

const configured: BotSettings = {
  name: 'Nova',
  personality: 'Curious, dry, and protective.',
  voice: 'default',
  interests: 'space, games',
  aliases: 'N',
};

test('community fallback keeps tenant personality but uses StreamWeaver87 identity', () => {
  const effective = applyBotTransportIdentity(configured, false);
  assert.equal(effective.name, COMMUNITY_BOT_NAME);
  assert.equal(effective.personality, configured.personality);
  assert.equal(effective.voice, configured.voice);
  assert.equal(effective.interests, configured.interests);
  assert.equal(effective.aliases, configured.aliases);
});

test('dedicated bot keeps the tenant configured bot name', () => {
  const effective = applyBotTransportIdentity(configured, true);
  assert.equal(effective.name, 'Nova');
  assert.deepEqual(effective, configured);
});
