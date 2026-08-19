import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.cwd());
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const signal = read('src/services/signal-system.ts');
const carrierSync = read('src/services/signal-carrier-sync.ts');
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

test('Discord !signal is a local cosmetic replacement only', () => {
  assert.match(signal, /provider: 'discord'/);
  assert.match(signal, /entitlement\.eggs\.signal/);
  assert.match(signal, /usage: !signal <message>/);
  assert.match(signal, /sendWebhookMessage/);
  assert.match(signal, /input\.sourceChannelId/);
  assert.match(signal, /input\.actualUsername/);
  assert.match(signal, /SIGNAL_DISCORD_GIF_URL/);
  assert.match(signal, /description: boldSignalText\(signalText\)/);
  assert.match(signal, /deleteMessage\(input\.sourceChannelId, sourceMessageId\)/);
  assert.doesNotMatch(signal, /resolveDiscordStreamHubTwitchIdentity/);

  const discordStart = signal.indexOf('export async function handleDiscordSignalCommand');
  const twitchStart = signal.indexOf('export async function handleTwitchSignalCommand');
  const discordBody = signal.slice(discordStart, twitchStart);
  assert.doesNotMatch(discordBody, /postDiscordStreamHubSignal/);
  assert.doesNotMatch(discordBody, /signalCooldownAvailable/);
  assert.doesNotMatch(discordBody, /recordSignalCooldown/);
});

test('Twitch !signal uses the current broadcaster and asks DSH for its Discord destination', () => {
  assert.match(signal, /provider: 'twitch'/);
  assert.match(signal, /usage: !signal <message>/);
  assert.match(signal, /input\.broadcaster\.replace/);
  assert.match(signal, /postDiscordStreamHubSignal/);
  assert.match(signal, /signalCooldownAvailable\(targetName\)/);
  assert.match(signal, /recordSignalCooldown\(targetName\)/);
  assert.match(signal, /resolveDiscordStreamHubSignalDestination\(\)/);
  assert.match(signal, /\/api\/internal\/signal\/channel/);
  assert.match(signal, /Authorization: `Bearer \$\{secret\}`/);
  const twitchStart = signal.indexOf('export async function handleTwitchSignalCommand');
  const twitchBody = signal.slice(twitchStart);
  assert.doesNotMatch(twitchBody, /resolveSignalChannelId\(guildId\)/);
  assert.match(signal, /SIGNAL_TWITCH_TENANT_ID/);
  assert.match(signal, /SIGNAL ACKNOWLEDGED/);
  assert.match(signal, /sendChatMessage\([^]*'bot', targetName, SIGNAL_TWITCH_TENANT_ID\)/);
});

test('DSH shoutout roster is synced into the shared Twitch community bot', () => {
  assert.match(carrierSync, /\/api\/internal\/signal\/carriers/);
  assert.match(carrierSync, /Authorization: `Bearer \$\{DSH_SECRET\}`/);
  assert.match(carrierSync, /syncSignalCarrierChannels\(channels\)/);
  assert.match(carrierSync, /SIGNAL_CARRIER_SYNC_MS/);
  assert.match(patch, /signalCarrierChannels = new Set<string>/);
  assert.match(patch, /isSignalCarrier = signalCarrierChannels\.has\(channelName\)/);
  assert.match(patch, /!tenantId && isSignalCarrier/);
  assert.match(patch, /self \|\| !\/\^!signal/);
  assert.match(patch, /handleTwitchSignalCommand/);
  assert.match(patch, /Carrier !signal failed/);
  assert.match(patch, /Signal failed:/);
  assert.match(patch, /export async function syncSignalCarrierChannels/);
  assert.match(patch, /startSignalCarrierRosterSync/);
});

test('runtime patch wires !signal in both Discord and Twitch without enabling the held scheduler', () => {
  assert.match(patch, /handleDiscordSignalCommand/);
  assert.match(patch, /handleTwitchSignalCommand/);
  assert.match(patch, /cmdName === 'signal'/);
  assert.match(patch, /\^!signal/);
  assert.match(patch, /startSignalScheduler/);
  assert.match(patch, /process\.env\.SIGNAL_SCHEDULER_ENABLED === 'true'/);
  assert.doesNotMatch(carrierSync, /startSignalScheduler/);
});
