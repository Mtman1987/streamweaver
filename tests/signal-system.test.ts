import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.cwd());
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const signal = read('src/services/signal-system.ts');
const patch = read('scripts/patch-signal-system.mjs');

test('Signal clue scheduler starts with comms-lounge and uses a persistent 2-5 hour shuffle bag', () => {
  assert.match(signal, /SIGNAL_CHANNEL_NAME = 'comms-lounge'/);
  assert.match(signal, /SIGNAL_MIN_DELAY_MS = 2 \* 60 \* 60 \* 1000/);
  assert.match(signal, /SIGNAL_MAX_DELAY_MS = 5 \* 60 \* 60 \* 1000/);
  assert.match(signal, /signal-scheduler\.json/);
  assert.match(signal, /if \(!lastChannelId && first\) return \[first\.id, \.\.\.rest\]/);
  assert.match(signal, /bag\[0\] === lastChannelId/);
  assert.match(signal, /log\|staff\|admin\|support\|ticket\|announce/);
  assert.match(signal, /UNIDENTIFIED SIGNAL/);
  assert.match(signal, /Intercept Signal/);
  assert.match(signal, /sendStructuredDiscordReply/);
});

test('Discord !signal requires Egg 3, targets comms-lounge, preserves the user identity, then deletes the source command', () => {
  assert.match(signal, /provider: 'discord'/);
  assert.match(signal, /entitlement\.eggs\.signal/);
  assert.match(signal, /resolveDiscordStreamHubTwitchIdentity/);
  assert.match(signal, /kind: 'signal'/);
  assert.match(signal, /sendWebhookMessage/);
  assert.match(signal, /input\.actualUsername/);
  assert.match(signal, /input\.sourceUserAvatarUrl/);
  assert.match(signal, /deleteMessage\(input\.sourceChannelId, sourceMessageId\)/);
  assert.match(signal, /resolveSignalChannelId\(guildId, input\.sourceChannelId\)/);
});

test('Signal cooldown is broadcaster scoped, persistent, and only recorded after a successful DSH carrier post', () => {
  assert.match(signal, /signal-command-cooldowns\.json/);
  assert.match(signal, /async function signalCooldownAvailable/);
  assert.match(signal, /async function recordSignalCooldown/);
  assert.doesNotMatch(signal, /claimSignalCooldown/);
  const discordPost = signal.indexOf('const posted = await postDiscordStreamHubSignal({');
  const discordRecord = signal.indexOf('await recordSignalCooldown(targetName);', discordPost);
  assert.ok(discordPost >= 0 && discordRecord > discordPost);
});

test('Twitch !signal requires Egg 3, targets the current broadcaster, posts the Discord carrier and acknowledges as SpaceMountainLive', () => {
  assert.match(signal, /provider: 'twitch'/);
  assert.match(signal, /input\.broadcaster\.replace/);
  assert.match(signal, /SIGNAL_TWITCH_TENANT_ID/);
  assert.match(signal, /SIGNAL ACKNOWLEDGED/);
  assert.match(signal, /sendChatMessage\([^]*'bot', targetName, SIGNAL_TWITCH_TENANT_ID\)/);
});

test('runtime patch wires !signal in both Discord and Twitch and arms the scheduler', () => {
  assert.match(patch, /handleDiscordSignalCommand/);
  assert.match(patch, /handleTwitchSignalCommand/);
  assert.match(patch, /cmdName === 'signal'/);
  assert.match(patch, /\^!signal/);
  assert.match(patch, /startSignalScheduler/);
});
