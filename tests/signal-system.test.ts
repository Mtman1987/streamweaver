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
const dispatcher = read('src/services/chat-dispatcher.ts');
const server = read('server.ts');

test('random Signal posting is permanently disabled and command-only', () => {
  assert.match(signal, /export async function toggleSignalScheduler/);
  assert.match(signal, /enabled: false, bag: \[\], nextAt: 0/);
  assert.match(signal, /return \{ enabled: false, nextAt: 0 \}/);
  assert.doesNotMatch(signal, /schedulerTimer = setInterval/);
  assert.doesNotMatch(server, /startSignalScheduler/);
  assert.doesNotMatch(dispatcher, /cmdName === 'signalbot'/);
  assert.doesNotMatch(dispatcher, /toggleSignalScheduler/);
});

test('Signal clues stay neutral and never load an unrelated tenant AI persona', () => {
  assert.match(signal, /SIGNAL_NEUTRAL_FALLBACKS/);
  assert.match(signal, /function generateSignalClue\(\): string/);
  assert.doesNotMatch(signal, /getBotPersonality/);
  assert.doesNotMatch(signal, /generateAIResponse/);
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

test('Twitch !signal toggles the shared hunt while !signal <message> keeps the earned carrier reward', () => {
  assert.match(signal, /provider: 'twitch'/);
  assert.match(signal, /toggleDiscordStreamHubSignalSeeker/);
  assert.match(signal, /check your whispers for the egg-hunt invitation/);
  assert.match(signal, /you're now a Signal Seeker/);
  assert.match(signal, /input\.broadcaster\.replace/);
  assert.match(signal, /postDiscordStreamHubSignal/);
  assert.match(signal, /signalCooldownAvailable\(targetName\)/);
  assert.match(signal, /recordSignalCooldown\(targetName\)/);
  assert.match(patch, /resolveDiscordStreamHubSignalDestination\(\)/);
  assert.match(patch, /\/api\/internal\/signal\/channel/);
  assert.match(patch, /Authorization/);
  assert.match(patch, /Bearer/);
  assert.match(patch, /deferAcknowledgement\?: boolean/);
  assert.match(patch, /if \(!input\.deferAcknowledgement\)/);
  assert.match(patch, /message: acknowledgement/);
  const twitchStart = signal.indexOf('export async function handleTwitchSignalCommand');
  const twitchBody = signal.slice(twitchStart);
  assert.match(twitchBody, /resolveDiscordStreamHubSignalDestination\(\)/);
  assert.match(patch, /const \{ guildId, channelId \} = await resolveDiscordStreamHubSignalDestination\(\)/);
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
  assert.match(patch, /read-only for StreamWeaverBot/);
  assert.match(patch, /sayCarrierReply = async \(_text: string\): Promise<boolean> => false/);
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
  assert.match(carrierAthena, /handleTwitchCarrierAthenaCall/);
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

test('runtime patch removes legacy random Signal scheduler controls', () => {
  assert.match(patch, /handleDiscordSignalCommand/);
  assert.match(patch, /handleTwitchSignalCommand/);
  assert.match(patch, /source = source\.replace\(signalBotBlock, ''\)/);
  assert.match(patch, /source\.replace\(schedulerBlock, ''\)/);
  assert.doesNotMatch(server, /startSignalScheduler/);
  assert.doesNotMatch(dispatcher, /cmdName === 'signalbot'/);
  assert.doesNotMatch(dispatcher, /toggleSignalScheduler/);
});

test('disabled scheduler exports cannot be used to re-enable random posts', () => {
  assert.match(signal, /toggleSignalScheduler\(_force\?: boolean\)/);
  assert.match(signal, /const disabled: SchedulerState = \{ enabled: false, bag: \[\], nextAt: 0 \}/);
  assert.match(signal, /writeJson\(SIGNAL_SCHEDULER_STATE, disabled\)/);
  assert.match(signal, /Signals are opened[\s\S]*explicit bare !signal command/);
  assert.doesNotMatch(signal, /schedulerTimer/);
});
