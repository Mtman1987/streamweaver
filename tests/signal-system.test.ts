import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.cwd());
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const signal = read('src/services/signal-system.ts');
const carrierSync = read('src/services/signal-carrier-sync.ts');
const carrierAthena = read('src/services/carrier-athena.ts');
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

test('Signal hint posts keep a readable persistent count and channel history', () => {
  assert.match(signal, /signal-hint-history\.json/);
  assert.match(signal, /totalPosts/);
  assert.match(signal, /uniqueChannelIds/);
  assert.match(signal, /channelName/);
  assert.match(signal, /lastPostAt/);
  assert.match(signal, /recordSignalHintPost\(guildId, channel\)/);
  assert.match(signal, /history\.slice\(-SIGNAL_HINT_HISTORY_LIMIT\)|slice\(-SIGNAL_HINT_HISTORY_LIMIT\)/);
  assert.match(signal, /\[Signal\] hint posted/);
  assert.match(signal, /uniqueChannels: nextState\.uniqueChannelIds\.length/);
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
  assert.match(signal, /deferAcknowledgement\?: boolean/);
  assert.match(signal, /if \(!input\.deferAcknowledgement\)/);
  assert.match(signal, /message: acknowledgement/);
  const twitchStart = signal.indexOf('export async function handleTwitchSignalCommand');
  const twitchBody = signal.slice(twitchStart);
  assert.doesNotMatch(twitchBody, /resolveSignalChannelId\(guildId\)/);
  assert.match(signal, /SIGNAL_TWITCH_TENANT_ID/);
  assert.match(signal, /SIGNAL ACKNOWLEDGED/);
});

test('DSH shoutout roster is synced into the shared Twitch community bot', () => {
  assert.match(carrierSync, /\/api\/internal\/signal\/carriers/);
  assert.match(carrierSync, /Authorization: `Bearer \$\{DSH_SECRET\}`/);
  assert.match(carrierSync, /SIGNAL_CARRIER_SYNC_MS/);
  assert.match(patch, /signalCarrierChannels = new Set<string>/);
  assert.match(patch, /isSignalCarrier = signalCarrierChannels\.has\(channelName\)/);
  assert.match(patch, /!tenantId && isSignalCarrier/);
  assert.match(patch, /handleTwitchSignalCommand/);
  assert.match(patch, /deferAcknowledgement: true/);
  assert.match(patch, /sayCarrierReply/);
  assert.match(patch, /Failed to reply in carrier/);
  assert.match(patch, /Carrier !signal failed/);
  assert.match(patch, /Signal failed:/);
  assert.match(patch, /export async function syncSignalCarrierChannels/);
  assert.match(patch, /startSignalCarrierRosterSync/);
});

test('authorized Athena calls work in non-tenant shoutout carrier chats only through the narrow carrier path', () => {
  assert.match(carrierAthena, /ATHENA_WHITELIST_TENANT_ID/);
  assert.match(carrierAthena, /canUseAthenaEverywhere/);
  assert.match(carrierAthena, /athena\|annie\|athenabot87/i);
  assert.match(carrierAthena, /athena-everywhere-mode\.json/);
  assert.match(carrierAthena, /\/api\/ai\/chat-with-memory/);
  assert.match(carrierAthena, /tenantId: ATHENA_WHITELIST_TENANT_ID/);
  assert.match(carrierAthena, /channelId:/);
  assert.match(carrierAthena, /context: 'twitch'/);
  assert.match(carrierAthena, /Athena failed:/);
  assert.match(patch, /handleTwitchCarrierAthenaCall/);
  assert.match(patch, /athena\|annie\|athenabot87/i);
  assert.match(patch, /athenaResult\.handled && athenaResult\.message/);
});

test('ChatTag no-bot blacklist overrides DSH shoutout carrier membership', () => {
  assert.match(carrierSync, /CHAT_TAG_BASE_URL/);
  assert.match(carrierSync, /\/api\/bot\/blacklist/);
  assert.match(carrierSync, /payload\?\.blacklisted/);
  assert.match(carrierSync, /Promise\.all\(\[/);
  assert.match(carrierSync, /fetchSignalCarrierRoster\(\)/);
  assert.match(carrierSync, /fetchChatTagBotBlacklist\(\)/);
  assert.match(carrierSync, /eligibleChannels = channels\.filter\(\(channel\) => !botBlacklist\.has\(channel\)\)/);
  assert.match(carrierSync, /syncSignalCarrierChannels\(eligibleChannels\)/);
  assert.match(carrierSync, /chatTagBotOptOuts: excluded/);
  assert.doesNotMatch(carrierSync, /syncSignalCarrierChannels\(channels\)/);
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
