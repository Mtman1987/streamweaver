import { getAllCommands } from '../lib/commands-store';
import { getActionById, getAllActions } from '../lib/actions-store';
import { runFlowGraph, defaultFlowServices } from '../lib/flow-runtime';
import { deleteMessage, sendDiscordEmbed, sendDiscordMessage, uploadBinaryFileToDiscord } from './discord';
import { buildDiscordUserAvatarUrl } from './discord-branding';
import { getTwitchChannelLiveStatus, sendChatMessage, sendTwitchChatMessage } from './twitch';
import { getKickService } from './kick';
import { addPoints, awardChatPoints, formatCompactPointAmount } from './points';
import { givePoints, stealPoints } from './points-transfer';
import { getWelcomeEligibility, markUserWelcomed, getWelcomeMode } from './welcome-wagon';
import { handleWalkOnShoutout } from './walk-on-shoutout';
import { handleVoiceShoutout } from './voice-shoutout';
import { extractShoutoutRequestTarget, matchShoutoutTarget } from './shoutout-matcher';
import { auditError, recordShoutoutAudit } from './shoutout-audit';
import { autoTranslateIncoming, isTranslationActive, handleOneOffTranslation, isUserAutoTranslate } from './translation-manager';
import { handleLeaderboardCommand } from './leaderboard-commands';
import { startBRB, stopBRB, toggleClipMode, getClipMode } from './brb-clips';
import { handleGamble as handleClassicGamble, handleRoll, handleDouble } from './gamble/classic-gamble';
import { getPoints, getPointBalance, setPoints, settleWager } from './points';
import { getAIConfig } from './ai-provider';
import { getBotName, tenantHasBotAccount } from '../lib/bot-settings-store';
import { getSpmtEasterEggEntitlement } from '../lib/spmt-easter-eggs';
import {
    THE_COUNT_NAME,
    THE_COUNT_PERSONALITY,
    isTheCountTwitchLogin,
    messageInvokesTheCount,
} from '../lib/the-count';
import { internalServiceHeaders } from '../lib/internal-service-auth';
import { replaceDiscordUserMentions } from './discord-mentions';
import { getTenantIdFromChannel } from './twitch-client';
import { incrementMetric } from './metrics';
import { isKnownBot } from './known-bots';
import { ATHENA_WHITELIST_TENANT_ID } from './athena-whitelist';
import { readWorldLore, type WorldLoreCharacter } from '../lib/world-lore-store';
import { readUserConfigSync } from '../lib/user-config';
import { handleKickMessage as dispatchKickMessage } from './kick-dispatcher';
import { SubActionType, TriggerType } from './automation/types';
import type { KickMessage } from './kick';
import * as fs from 'fs/promises';
import { resolve } from 'path';
import {
    globalPath,
    listTenants,
    tenantPath,
    SPACEMOUNTAIN_SYSTEM_TENANT_ID,
} from '../lib/tenant';
import { queueTtsOverlay } from './tts-overlay-queue';
import { buildPokemonBrowserUrl } from './pokemon-browser';
import { readDiscordConfig } from '../lib/discord-config';
import { recordDashboardActivity } from '../lib/dashboard-activity-store';
import { appendPublicChatMessages } from '../lib/public-chat-store';
import type { StorageContext } from './storage';
import { getChatOutputContext, runWithChatOutputContext } from './chat-output-context';
import { sendDiscordCommandShoutout } from './discord-command-shoutout';
import {
    deleteStructuredDiscordReply,
    editStructuredDiscordReply,
    resolveStructuredDiscordReplySpeaker,
    sendStructuredDiscordReply,
} from './discord-structured-replies';
import {
    buildDiscordAdminCommandsSummary,
    buildDiscordCommandDirectoryFields,
    buildDiscordCommandsSummary,
    DISCORD_ROUTED_COMMAND_NAMES,
    DISCORD_UNSUPPORTED_COMMAND_MESSAGES,
} from './discord-command-catalog';
import {
    beginLoungeCommandMenu,
    consumeLoungeCommandMenuChoice,
    directLoungeCommandCategory,
} from './lounge-command-menu';
import { handleDiscordPokemonCommand } from './discord-pokemon-commands';
import { generateSocialCommandReply, isSocialCommandName, SOCIAL_COMMAND_NAMES } from './social-command-replies';
import { isSocialOverlayCommand, publishSocialOverlayEvent } from './social-overlay-events';
import { executeHearMeOutBotAction } from './hearmeout-actions';
import { overrideLoungeMediaLayout, voteLoungeMediaLayout } from './lounge-media-layout';
import { hasDiscordModAccess } from './discord-permissions';
import { detectBotRelayRequest, detectBotRelayRequestWithAi } from './bot-relay';
import {
    buildRelayReplyInstructions,
    extractRelayQuotedSegments,
    extractRelayReplyCommand,
    preserveRelayQuotedSegments,
} from './relay-message-format';
import {
    completeRelayReplyThread,
    getLatestRelayReplyThread,
    recordRelayReplyThread,
    type RelayConversationTurn,
} from '../lib/relay-reply-thread-store';
import {
    addDiscordStreamHubPointsToAll,
    checkDiscordStreamHubAdminAccess,
    getDiscordStreamHubActivityLeaderboard,
    getDiscordStreamHubActivitySummary,
    getDiscordStreamHubPoints,
    getDiscordStreamHubPointsLeaderboard,
    getDiscordStreamHubTenantPoints,
    getDiscordStreamHubTenantActivity,
    getDiscordStreamHubLeaderboardPost,
    lookupDiscordStreamHubTwitchTarget,
    resolveDiscordStreamHubTwitchIdentity,
    setDiscordStreamHubPoints,
    setDiscordStreamHubPointsToAll,
} from './discord-stream-hub';
import { getTenantBroadcasterChannel, resolveTwitchReplyChannel } from './tenant-chat-routing';
import {
    beginPendingMtSupportRequest,
    consumePendingMtSupportRequest,
    detectMtFixItIntent,
    getMtFixItPublicReply,
    getMtSupportPrompt,
    submitMtSupportReport,
} from './mt-support-report';
import { findDiscordLastSeenForNames, findDiscordLastSeenForUserId } from './discord-last-seen';
import { lookupDiscordRelayPresence } from './discord-relay-presence';
import { getInternalAppUrl } from '../lib/runtime-origin';
import { routeBotAction, type BotActorRole } from './bot-action-runtime';
import {
    applySayState,
    cleanSayTextForSpeech,
    formatSaySpeechText,
    isSayEnabled,
    hasSayEnabledInChannel,
    isSaySuppressedForTenant,
    isSayTextSpeakable,
    normalizeSayUser,
    parseSayState,
    readSayUsers,
    resolveSayStreamKey,
    sayAllKey,
    sayUserKey,
    buildSayPlayerUrl,
    stripTwitchEmotesFromText,
    writeSayUsers,
} from './say-tts';

type DiscordDispatchOptions = {
    skipPublicHistory?: boolean;
    skipAiMentions?: boolean;
    skipTwitchBridge?: boolean;
    replyMode?: 'structured' | 'bot';
};

// Gamble handlers report the net change, while the wallet settles stake vs payout:
// a 500 stake returning +250 profit is a 500 wager with a 750 payout.
async function settleWagerResult(
    username: string,
    result: { betAmount: string; change: string; newTotal: string },
    eventType: 'gamble' | 'roll' | 'double',
    ctx?: StorageContext,
) {
    const wager = BigInt(result.betAmount || '0');
    const change = BigInt(result.change || '0');
    const payout = wager + change > 0n ? wager + change : 0n;
    await settleWager(username, { wager, payout, newTotal: result.newTotal, eventType }, ctx);
}

function parseTimeoutDuration(input: string | undefined): { seconds: number; consumed: boolean } {
    const raw = String(input || '').trim().toLowerCase();
    if (!raw) return { seconds: 600, consumed: false };
    const match = raw.match(/^(\d+)(s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days)?$/i);
    if (!match) return { seconds: 600, consumed: false };

    const value = Number(match[1]);
    const unit = match[2] || 's';
    const multiplier =
        unit.startsWith('d') ? 86400 :
        unit.startsWith('h') ? 3600 :
        unit.startsWith('m') ? 60 :
        1;
    return { seconds: Math.max(1, Math.min(1_209_600, value * multiplier)), consumed: true };
}

function formatDiscordActivityMinutes(minutes: number): string {
    const totalMinutes = Math.max(0, Math.trunc(Number(minutes || 0)));
    const hours = Math.floor(totalMinutes / 60);
    const remainder = totalMinutes % 60;
    if (!hours) return `${remainder}m`;
    if (!remainder) return `${hours}h`;
    return `${hours}h ${remainder}m`;
}

function formatIsoDateLabel(value?: string | null): string {
    const iso = String(value || '').trim();
    if (!iso) return 'unknown';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return 'unknown';
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatDiscordLeaderboard(entries: Array<{ displayName?: string; username?: string; points?: number }>, emptyLabel: string): string {
    if (!entries.length) return emptyLabel;
    return entries
        .map((entry, index) => `#${index + 1} ${(entry.displayName || entry.username || `User ${index + 1}`)} ${Number(entry.points || 0).toLocaleString()}`)
        .join(' | ');
}

function formatDiscordActivityLeaderboard(entries: Array<{
    displayName?: string;
    username?: string;
    messageCount: number;
    activeDays: number;
    voiceMinutes: number;
}>, emptyLabel: string): string {
    if (!entries.length) return emptyLabel;
    return entries
        .map((entry, index) => `#${index + 1} ${(entry.displayName || entry.username || `User ${index + 1}`)} ${entry.messageCount} msgs, ${entry.activeDays} days, ${formatDiscordActivityMinutes(entry.voiceMinutes)}`)
        .join(' | ');
}

type DiscordCommandEmbedOptions = {
    title?: string;
    imageUrl?: string;
    thumbnailUrl?: string;
    color?: number;
    fields?: Array<{ name: string; value: string; inline?: boolean }>;
    components?: Record<string, unknown>[];
};

const DISCORD_POINTS_COLOR = 0xF5A524;
const DISCORD_POINTS_ICON = 'ğŸ’ ';
const DISCORD_LEADERBOARD_ICON = 'ğŸ†';

function rankMedal(rank: number): string {
    if (rank === 1) return 'ğŸ¥‡';
    if (rank === 2) return 'ğŸ¥ˆ';
    if (rank === 3) return 'ğŸ¥‰';
    return `\`#${String(rank).padStart(2, ' ')}\``;
}

function parseDiscordCommandTarget(msg: any, rawTarget: string): { userId: string; username?: string; displayName?: string; avatarUrl?: string } | null {
    const target = String(rawTarget || '').trim();
    const mentionMatch = target.match(/^<@!?(\d+)>$/);
    if (!mentionMatch) return null;

    const targetId = mentionMatch[1];
    const mentionsUsers = msg.mentions?.users;
    const mentionsMembers = msg.mentions?.members;

    const readMention = (source: any) => {
        if (!source) return null;
        if (typeof source.get === 'function') {
            return source.get(targetId) || null;
        }
        if (Array.isArray(source)) {
            return source.find((entry: any) => String(entry?.id || entry?.user?.id) === targetId) || null;
        }
        return source[targetId] || null;
    };

    const user = readMention(mentionsUsers);
    const member = readMention(mentionsMembers);
    const avatarHash = user?.avatar || member?.user?.avatar;
    return {
        userId: targetId,
        username: user?.username || member?.user?.username,
        displayName: user?.globalName || user?.global_name || member?.displayName || member?.nick || user?.username,
        avatarUrl: (typeof user?.avatarUrl === 'string' && user.avatarUrl)
            || buildDiscordUserAvatarUrl(targetId, avatarHash)
            || undefined,
    };
}

const PERMANENT_APP_OWNER_DISCORD_IDS = new Set([
    '767875979561009173',
    String(process.env.STREAMWEAVER_OWNER_DISCORD_ID || '').trim(),
    String(process.env.NEXT_PUBLIC_HARDCODED_ADMIN_DISCORD_ID || '').trim(),
].filter(Boolean));

function isPermanentDiscordOwner(msg: any): boolean {
    const userId = String(msg.author?.id || msg.userId || msg.user_id || '').trim();
    return Boolean(userId && PERMANENT_APP_OWNER_DISCORD_IDS.has(userId));
}

async function hasEffectiveDiscordModAccess(msg: any): Promise<boolean> {
    // The application owner must never depend on a network permission lookup.
    if (isPermanentDiscordOwner(msg)) return true;
    if (hasDiscordModAccess(msg)) return true;

    const guildId = msg.guildId || msg.guild_id;
    const userId = msg.author?.id || msg.userId || msg.user_id;
    const access = await checkDiscordStreamHubAdminAccess({ guildId, userId });
    return Boolean(access?.isAdmin || access?.isMod || access?.isOwner);
}

const DISCORD_PRIVILEGED_ROUTED_COMMANDS = new Set([
    'admin', 'ignore', 'timeout',
    'addpoints', 'setpoints', 'addtoall', 'settoall', 'resetallpoints',
    'greetingmode', 'welcomemode', 'clipmode', 'chatmode', 'athenaeverywhere',
    'addflow', 'approveflow', 'disableflow', 'deleteflow',
]);

const DISCORD_NATIVE_SOCIAL_COMMANDS = new Set(SOCIAL_COMMAND_NAMES);

const DISCORD_NATIVE_COMMAND_NAMES = new Set([
    ...DISCORD_NATIVE_SOCIAL_COMMANDS,
    'commands', 'admin', 'so', 'watchtime', 'time', 'coinflip', 'leaderboard',
    'followers', 'uptime', 'stats',
    'timeout', 'raidmessage', 'mtfixit',
    'ignore',
    'addflow', 'approveflow', 'disableflow', 'deleteflow',
]);

async function commandHasActionTrigger(commandId: string, tenantId?: string): Promise<boolean> {
    if (!commandId) return false;
    const actions = await getAllActions(tenantId);
    return actions.some((action: any) =>
        action?.enabled &&
        Array.isArray(action.triggers) &&
        action.triggers.some((trigger: any) =>
            trigger?.enabled !== false &&
            Number(trigger?.type) === 401 &&
            String(trigger?.commandId || '') === String(commandId)
        )
    );
}

async function routeDiscordCommandThroughTwitchRuntime(msg: any, tenantId?: string): Promise<boolean> {
    const sourceChannelId = msg.channelId || msg.channel_id;
    const actualMessage = String(msg.content || '').trim();
    if (!sourceChannelId || !actualMessage.startsWith('!')) return false;

    const cmdName = actualMessage.slice(1).split(/\s+/)[0]?.toLowerCase() || '';
    if (!cmdName) return false;

    const configuredCommands = await getAllCommands(tenantId);
    const configuredCommand = configuredCommands.find((command: any) =>
        String(command?.command || '').toLowerCase().replace(/^!/, '') === cmdName
    );

    // Let the native Discord executor handle commands that already have a real
    // Discord-side implementation. Route the remaining built-ins through the
    // Twitch dispatcher so shared handlers like mode toggles still work.
    if (
        configuredCommand &&
        (
            DISCORD_NATIVE_COMMAND_NAMES.has(cmdName) ||
            Boolean((configuredCommand as any)?.response) ||
            Boolean((configuredCommand as any)?.actionId) ||
            Boolean((configuredCommand as any)?.actions?.length) ||
            await commandHasActionTrigger(String((configuredCommand as any)?.id || ''), tenantId)
        )
    ) {
        return false;
    }

    if (!DISCORD_ROUTED_COMMAND_NAMES.includes(cmdName)) {
        return false;
    }

    const discordUserId = String(msg.author?.id || msg.userId || msg.user_id || '').trim();
    const guildId = String(msg.guildId || msg.guild_id || '').trim();
    const linkedIdentity = discordUserId && guildId
        ? await resolveDiscordStreamHubTwitchIdentity(discordUserId, guildId).catch(() => null)
        : null;
    const username = String(
        linkedIdentity?.twitchLogin ||
        msg.author?.username ||
        msg.author?.globalName ||
        msg.author?.global_name ||
        'DiscordUser'
    ).trim().toLowerCase();
    // Public commands such as !points and !pleader must never wait on
    // DiscordStreamHub admin lookup. Only commands that actually require
    // elevated Twitch-style tags perform the remote permission check.
    const isMod = DISCORD_PRIVILEGED_ROUTED_COMMANDS.has(cmdName)
        ? await hasEffectiveDiscordModAccess(msg)
        : (isPermanentDiscordOwner(msg) || hasDiscordModAccess(msg));

    const tags = {
        username,
        'display-name': msg.author?.globalName || msg.author?.global_name || username,
        mod: isMod,
        badges: {
            broadcaster: Boolean(msg.isOwner),
        },
        id: msg.messageId || msg.message_id || `${Date.now()}`,
    };

    const broadcasterChannel = await getTenantBroadcasterChannel(tenantId);
    await runWithChatOutputContext({
        platform: 'discord',
        channelId: sourceChannelId,
        guildId: msg.guildId || msg.guild_id,
        userId: msg.author?.id || msg.userId || msg.user_id,
        username,
        displayName: msg.author?.globalName || msg.author?.global_name || username,
        userAvatarUrl: msg.author?.avatarUrl
            || msg.author?.displayAvatarURL
            || msg.userAvatar
            || msg.avatarUrl
            || msg.avatar_url
            || buildDiscordUserAvatarUrl(msg.author?.id || msg.userId || msg.user_id, msg.author?.avatar),
        messageId: msg.messageId || msg.message_id,
        messageContent: actualMessage,
        speakerMode: 'command',
    }, async () => {
        await handleTwitchMessage(`#${broadcasterChannel}`, tags, actualMessage, false);
    });

    return true;
}

async function bridgeDiscordMessageToTwitch(msg: any, tenantId?: string) {
    const rawContent = String(msg.content || '');
    if (rawContent.startsWith('[') || rawContent.startsWith('!')) return;

    let processedContent = replaceDiscordUserMentions(msg.content, msg.mentions);
    processedContent = processedContent.replace(/<:(\w+):(\d+)>/g, ':$1:');

    const sourceUserName = msg.author?.username || msg.author?.globalName || msg.author?.global_name || 'Discord User';
    const twitchMessage = `[Discord] ${sourceUserName}: ${processedContent}`;
    await sendChatMessage(twitchMessage, 'bot', undefined, tenantId).catch(e => console.error('[Bridge] Failed:', e));
}

async function getTenantDiscordDmChannelId(tenantId?: string): Promise<string | null> {
    if (!tenantId) return null;
    try {
        const config = await readDiscordConfig(tenantId);
        const value = String(config?.dmChannelId || '').trim();
        return value || null;
    } catch {
        return null;
    }
}

export async function resolveRelayTarget(input: {
    namedTarget?: string;
    structuredTarget?: WorldLoreCharacter;
    fallbackTenantId?: string;
}): Promise<{ tenantId?: string; character: WorldLoreCharacter } | null> {
    if (input.structuredTarget) {
        const tenantId = await resolveTenantForLoreBot(input.structuredTarget, input.fallbackTenantId);
        if (tenantId) {
            return { tenantId, character: input.structuredTarget };
        }
    }

    const rawTarget = String(input.namedTarget || '').replace(/^@/, '').trim().toLowerCase();
    if (!rawTarget) return null;

    try {
        const { listTenants } = await import('../lib/tenant');
        const { getStoredTokens } = await import('../lib/token-utils.server');
        const { getBotName, getBotAliases } = await import('../lib/bot-settings-store');
        const discordLastSeenTarget = await findDiscordLastSeenForNames([rawTarget]).catch(() => null);
        for (const tid of await listTenants()) {
            const tokens = await getStoredTokens(tid).catch(() => null);
            const broadcasterUsername = String(tokens?.broadcasterUsername || tokens?.loginUsername || '').trim().toLowerCase();
            const discordConfig = await readDiscordConfig(tid).catch(() => null);
            const discordUsername = String(discordConfig?.discordUsername || '').trim().replace(/^@/, '').toLowerCase();
            const discordUserId = String(discordConfig?.discordUserId || '').trim();
            const matchesLinkedDiscordDisplayName = Boolean(
                discordUserId
                && discordLastSeenTarget?.userId
                && String(discordLastSeenTarget.userId) === discordUserId
            );
            const configuredBotName = String(getBotName(tid) || '').trim();
            const configuredAliases = String(getBotAliases(tid) || '').split(',').map((value) => value.trim()).filter(Boolean);
            const botNames = new Set([configuredBotName, ...configuredAliases].map((value) => value.toLowerCase()));
            if (
                broadcasterUsername === rawTarget
                || discordUsername === rawTarget
                || matchesLinkedDiscordDisplayName
                || botNames.has(rawTarget)
            ) {
                const loreCharacter = await getLoreCharacterForTenant(tid);
                return {
                    tenantId: tid,
                    character: loreCharacter || {
                        stableId: `${tid}:bot`,
                        currentName: configuredBotName || rawTarget,
                        aliases: Array.from(new Set([rawTarget, ...configuredAliases])),
                    },
                };
            }
        }
    } catch (error) {
        console.error('[Dispatcher] Failed to resolve relay target:', error);
    }

    return null;
}

const DIRECT_HUMAN_RELAY_STOP_TARGETS = new Set([
    'your',
    'my',
    'his',
    'her',
    'their',
    'our',
    'the',
    'a',
    'an',
    'this',
    'that',
    'streamweaverbot',
    'athena',
    'athenabot87',
]);

function normalizeRelayHandle(value: unknown): string {
    return String(value || '')
        .trim()
        .replace(/^@/, '')
        .replace(/[^a-zA-Z0-9_-]+/g, '')
        .slice(0, 64);
}

export function isDirectHumanRelayTarget(value: unknown): boolean {
    const handle = normalizeRelayHandle(value);
    if (handle.length < 2) return false;
    if (DIRECT_HUMAN_RELAY_STOP_TARGETS.has(handle.toLowerCase())) return false;
    return /^[a-zA-Z0-9_][a-zA-Z0-9_-]{1,63}$/.test(handle);
}


export async function resolveHumanRelaySpeaker(input: {
    sourcePlatform: 'twitch' | 'discord';
    sourceUserName: string;
    sourceUserId?: string;
}): Promise<{ character: WorldLoreCharacter; tenantId?: string; usesCommunityBot: boolean }> {
    const sourceName = normalizeRelayHandle(input.sourceUserName).toLowerCase();
    const sourceUserId = String(input.sourceUserId || '').trim();

    try {
        for (const tid of await listTenants()) {
            let matchesAccount = input.sourcePlatform === 'twitch' && Boolean(
                (sourceUserId && sourceUserId === tid)
                || (
                    sourceName
                    && normalizeRelayHandle(readUserConfigSync(tid).TWITCH_BROADCASTER_USERNAME).toLowerCase() === sourceName
                )
            );

            if (input.sourcePlatform === 'discord') {
                const discordConfig = await readDiscordConfig(tid).catch(() => null);
                matchesAccount = Boolean(
                    (sourceUserId && sourceUserId === String(discordConfig?.discordUserId || '').trim())
                    || (
                        sourceName
                        && normalizeRelayHandle(discordConfig?.discordUsername).toLowerCase() === sourceName
                    )
                );
            }

            if (!matchesAccount) continue;
            const { getBotAliases } = await import('../lib/bot-settings-store');
            const botName = getBotName(tid);
            return {
                tenantId: tid,
                usesCommunityBot: false,
                character: await getLoreCharacterForTenant(tid) || buildFallbackLoreCharacter({
                    tenantId: tid,
                    name: botName,
                    aliases: String(getBotAliases(tid) || '').split(',').map((value) => value.trim()).filter(Boolean),
                }),
            };
        }
    } catch (error) {
        console.warn('[Dispatcher] Failed to resolve relay sender account; using community bot:', error);
    }

    const communityName = getBotName(undefined) || 'StreamWeaver87';
    return {
        usesCommunityBot: true,
        character: {
            stableId: 'community:streamweaverbot',
            currentName: communityName,
            aliases: Array.from(new Set([communityName, 'StreamWeaverBot', 'StreamWeaver87'])),
        },
    };
}


export function buildDirectHumanRelayMessage(input: {
    targetName: string;
    sourceUserName: string;
    relayMessage: string;
}): string {
    const handle = normalizeRelayHandle(input.targetName);
    const body = String(input.relayMessage || '').trim();
    return `${handle}, ${input.sourceUserName} says: ${body}`;
}

const DISCORD_RELAY_REPLY_FOOTER = 'Reply with "reply" or "yes" plus your message; "no" closes this relay â€¢ expires and deletes 10m after last activity';

function appendRelayHistory(
    history: RelayConversationTurn[] | undefined,
    turn: Omit<RelayConversationTurn, 'createdAt'>,
): RelayConversationTurn[] {
    return [
        ...(history || []),
        { ...turn, createdAt: new Date().toISOString() },
    ].slice(-12);
}

function buildDiscordRelayTranscript(history: RelayConversationTurn[]): string {
    const turns = history.slice(-2);
    return turns.map((turn) =>
        `**${turn.senderUsername} via ${turn.botName}:** ${turn.message}`
    ).join('\n\n');
}

function buildDiscordRelayHistoryFile(history: RelayConversationTurn[]) {
    if (history.length <= 2) return [];
    const archived = history.slice(0, -2);
    const body = archived.map((turn) => {
        const when = turn.createdAt ? new Date(turn.createdAt).toISOString() : '';
        return `${when ? `[${when}] ` : ''}${turn.senderUsername} via ${turn.botName}: ${turn.message}`;
    }).join('\n\n');
    return [{ name: 'relay-history.txt', content: body || 'No archived relay messages.' }];
}

async function sendDiscordRelayCard(input: {
    channelId: string;
    recipientUserId?: string;
    tenantId?: string;
    bot: WorldLoreCharacter;
    history: RelayConversationTurn[];
    isPrivate?: boolean;
}): Promise<string | undefined> {
    const sent = await sendStructuredDiscordReply({
        channelId: input.channelId,
        content: input.recipientUserId ? `<@${input.recipientUserId}>` : '',
        message: buildDiscordRelayTranscript(input.history),
        tenantId: input.tenantId,
        botName: input.bot.currentName,
        responseType: 'Message Relay',
        footerText: DISCORD_RELAY_REPLY_FOOTER,
        isPrivate: input.isPrivate,
        forceCleanup: true,
        includeConfiguredMedia: false,
        files: buildDiscordRelayHistoryFile(input.history),
    });
    return sent.messageId;
}

async function updateDiscordRelayCard(input: {
    channelId: string;
    messageId: string;
    tenantId?: string;
    bot: WorldLoreCharacter;
    history: RelayConversationTurn[];
    sourceMessageId?: string;
    sourceMessage?: string;
    sourceUser?: string;
    isPrivate?: boolean;
    footerText?: string;
}): Promise<boolean> {
    const result = await editStructuredDiscordReply(input.messageId, {
        channelId: input.channelId,
        message: buildDiscordRelayTranscript(input.history),
        tenantId: input.tenantId,
        botName: input.bot.currentName,
        responseType: 'Message Relay',
        footerText: input.footerText || DISCORD_RELAY_REPLY_FOOTER,
        sourceMessageId: input.sourceMessageId,
        sourceMessage: input.sourceMessage,
        sourceUser: input.sourceUser,
        isPrivate: input.isPrivate,
        forceCleanup: true,
        includeConfiguredMedia: false,
        files: buildDiscordRelayHistoryFile(input.history),
    });
    return result.edited;
}

async function buildRelayDeliveryMessage(input: {
    sourceUserName: string;
    speaker: WorldLoreCharacter;
    target: WorldLoreCharacter;
    relayMessage: string;
    targetAudienceName?: string;
    targetTenantId?: string;
    deliveryMode: 'live' | 'discord' | 'dm';
    includeReplyInstructions?: boolean;
}): Promise<string> {
    const quotedSegments = extractRelayQuotedSegments(input.relayMessage);
    const targetAudienceName = String(input.targetAudienceName || input.target.currentName || 'this chat').trim();
    const deliveryInstruction = input.deliveryMode === 'live'
        ? `You are speaking in ${targetAudienceName}'s Twitch chat. Deliver the message to that chat in one short natural sentence.`
        : input.deliveryMode === 'discord'
            ? `Tell ${targetAudienceName} in the Discord channel where they were last active in one short natural sentence.`
            : `Tell ${targetAudienceName} privately in one short natural sentence.`;
    const targetPersonality = [
        `You are ${input.target.currentName}.`,
        input.target.archetype ? `Archetype: ${input.target.archetype}.` : '',
        input.target.summary || '',
        input.target.personalityNotes?.length ? input.target.personalityNotes.join(' ') : '',
        input.deliveryMode === 'live'
            ? 'You are speaking in your streamer live chat.'
            : input.deliveryMode === 'discord'
                ? 'You are speaking in the Discord channel where your streamer was last active.'
                : 'You are privately DMing your streamer because they are offline.',
    ].filter(Boolean).join('\n');
    const quotePolicy = quotedSegments.length
        ? [
            'Text inside quote marks is immutable. Preserve the exact spelling, casing, punctuation, and word order inside every quoted span.',
            ...quotedSegments.map((segment, index) => `Immutable quote ${index + 1}: ${segment.full}`),
            'You may restyle only the words outside those quoted spans.',
        ]
        : [
            'No text is explicitly quoted, so you may naturally restyle the wording in your own personality while preserving its meaning.',
        ];

    const prompt = [
        'Human-directed cross-bot relay delivery.',
        `Original human sender: ${input.sourceUserName}.`,
        `Bot instructed by the human: ${input.speaker.currentName}.`,
        `Receiving bot speaking now: ${input.target.currentName}.`,
        `Receiving chat or streamer: ${targetAudienceName}.`,
        `Original message: ${input.relayMessage}`,
        `Make it clear that the message originated with ${input.sourceUserName} and was handed to you through ${input.speaker.currentName}.`,
        'Preserve the message meaning. Do not invent extra facts, promises, or actions.',
        ...quotePolicy,
        deliveryInstruction,
        `Do not address ${input.sourceUserName} as "you".`,
        'Do not mention internal systems or say this is automated.',
    ].filter(Boolean).join('\n');

    const aiRes = await fetch(`http://127.0.0.1:${process.env.PORT||3100}/api/ai/chat-with-memory`, {
        method: 'POST',
        headers: internalServiceHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
            username: targetAudienceName,
            displayName: targetAudienceName,
            message: prompt,
            personality: targetPersonality,
            responseName: input.target.currentName,
            tenantId: input.targetTenantId,
            context: input.deliveryMode === 'live' ? 'twitch-cross-bot' : 'discord-cross-bot',
        }),
    });

    if (!aiRes.ok) {
        throw new Error(`Relay AI failed: ${aiRes.status}`);
    }

    const data = await aiRes.json();
    const reply = String(data.response || data.data?.response || '').trim();
    if (!reply) throw new Error('Relay AI returned an empty response');
    const personalityReply = preserveRelayQuotedSegments(reply, input.relayMessage);
    return input.includeReplyInstructions
        ? `${personalityReply} ${buildRelayReplyInstructions(input.sourceUserName)}`.trim()
        : personalityReply;
}

export type BotRelayDeliveryResult = {
    delivered: boolean;
    mode?: 'live' | 'discord' | 'dm';
    error?: string;
    history?: RelayConversationTurn[];
    discordMessageId?: string;
    summary: string;
};

function relayDeliverySummary(targetName: string, mode?: BotRelayDeliveryResult['mode'], destination?: string, error?: string): string {
    if (mode === 'live') return `Delivered to ${targetName} in #${destination || 'their channel'} on Twitch.`;
    if (mode === 'discord') return `${targetName} was not reachable in Twitch chat, so I delivered it in their active Discord channel.`;
    if (mode === 'dm') return `${targetName} was not reachable in Twitch chat or an active Discord channel, so I sent them a DM.`;
    return `I couldn't reach ${targetName}: ${error || 'no delivery destination accepted the message'}`;
}

export async function deliverBotRelay(input: {
    sourcePlatform: 'twitch' | 'discord';
    sourceChannelId?: string;
    sourceContextTenantId?: string;
    sourceDiscordIsPrivate?: boolean;
    sourceDiscordRelayMessageId?: string;
    sourceUserName: string;
    sourceUserId?: string;
    triggerMessage: string;
    speaker: WorldLoreCharacter;
    speakerTenantId?: string;
    target: WorldLoreCharacter;
    targetTenantId?: string;
    targetPlatformOverride?: 'twitch' | 'discord';
    targetChannelOverride?: string;
    targetReplyContextTenantId?: string;
    targetDiscordIsPrivate?: boolean;
    replaceTargetDiscordMessageId?: string;
    recipientUsername?: string;
    recipientUserId?: string;
    relayMessage: string;
    conversationId?: string;
    history?: RelayConversationTurn[];
    /**
     * True only when a real person explicitly asked the speaking bot to deliver
     * this message. Bot-share consent governs autonomous bot conversation, not
     * a human-issued relay command.
     */
    humanDirected?: boolean;
}): Promise<BotRelayDeliveryResult> {
    const targetTenantId = input.targetTenantId || await resolveTenantForLoreBot(input.target, undefined);
    const hasExactTarget = Boolean(input.targetPlatformOverride && input.targetChannelOverride);
    const replyConversationId = input.conversationId
        || `relay-conversation-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    if (!targetTenantId && !hasExactTarget) {
        const error = `could not resolve ${input.target.currentName}`;
        return { delivered: false, error, summary: relayDeliverySummary(input.target.currentName, undefined, undefined, error) };
    }

    if (
        !input.humanDirected
        && (!targetTenantId || !(await isBotRelayAllowed(input.speakerTenantId, targetTenantId)))
    ) {
        const error = `${input.target.currentName} has not enabled bot sharing`;
        return { delivered: false, error, summary: relayDeliverySummary(input.target.currentName, undefined, undefined, error) };
    }

    const recordReplyPath = async (delivery: {
        platform: 'twitch' | 'discord';
        channelId: string;
        defaultRecipientUsername?: string;
        defaultRecipientUserId?: string;
        messageId?: string;
        isPrivate?: boolean;
        history?: RelayConversationTurn[];
    }) => {
        if (!input.humanDirected || !input.sourceChannelId) return;
        const recipientUsername = String(input.recipientUsername || delivery.defaultRecipientUsername || '').trim();
        const recipientUserId = String(input.recipientUserId || delivery.defaultRecipientUserId || '').trim();
        if (!recipientUsername && !recipientUserId) return;
        await recordRelayReplyThread({
            recipientContextTenantId: input.targetReplyContextTenantId || targetTenantId,
            conversationId: replyConversationId,
            recipientBot: input.target,
            recipientUsername: recipientUsername || undefined,
            recipientUserId: recipientUserId || undefined,
            deliveryPlatform: delivery.platform,
            deliveryChannelId: delivery.channelId,
            deliveryMessageId: delivery.messageId,
            deliveryIsPrivate: delivery.isPrivate,
            history: delivery.history,
            originPlatform: input.sourcePlatform,
            originChannelId: input.sourceChannelId,
            originContextTenantId: input.sourceContextTenantId,
            originTenantId: input.speakerTenantId,
            originBot: input.speaker,
            originSenderUsername: input.sourceUserName,
            originSenderUserId: input.sourceUserId,
            originMessageId: input.sourceDiscordRelayMessageId,
            originIsPrivate: input.sourceDiscordIsPrivate,
        });
    };

    try {
        if (hasExactTarget) {
            const targetPlatform = input.targetPlatformOverride!;
            const targetChannel = input.targetChannelOverride!;
            const relayText = await buildRelayDeliveryMessage({
                sourceUserName: input.sourceUserName,
                speaker: input.speaker,
                target: input.target,
                relayMessage: input.relayMessage,
                targetAudienceName: input.recipientUsername || targetChannel,
                targetTenantId,
                deliveryMode: targetPlatform === 'twitch' ? 'live' : 'discord',
                includeReplyInstructions: false,
            });
            const relayHistory = appendRelayHistory(input.history, {
                senderUsername: input.sourceUserName,
                botName: input.speaker.currentName,
                message: relayText,
            });
            let discordMessageId: string | undefined;
            if (targetPlatform === 'twitch') {
                const twitchText = input.humanDirected
                    ? `${relayText} ${buildRelayReplyInstructions(input.sourceUserName)}`.trim()
                    : relayText;
                await sendTwitchChatMessage(twitchText, 'bot', targetChannel, targetTenantId);
            } else {
                discordMessageId = await sendDiscordRelayCard({
                    channelId: targetChannel,
                    recipientUserId: input.recipientUserId,
                    tenantId: targetTenantId,
                    bot: input.target,
                    history: relayHistory,
                    isPrivate: input.targetDiscordIsPrivate,
                });
                if (discordMessageId && input.replaceTargetDiscordMessageId) {
                    await deleteStructuredDiscordReply(
                        targetChannel,
                        input.replaceTargetDiscordMessageId,
                    ).catch(() => false);
                }
            }
            await recordReplyPath({
                platform: targetPlatform,
                channelId: targetChannel,
                defaultRecipientUsername: input.recipientUsername,
                defaultRecipientUserId: input.recipientUserId,
                messageId: discordMessageId,
                isPrivate: targetPlatform === 'discord' ? input.targetDiscordIsPrivate : undefined,
                history: relayHistory,
            }).catch((error) => console.warn('[Dispatcher] Failed to record reverse relay reply path:', error));
            return {
                delivered: true,
                mode: targetPlatform === 'twitch' ? 'live' : 'discord',
                history: relayHistory,
                discordMessageId,
                summary: relayDeliverySummary(
                    input.target.currentName,
                    targetPlatform === 'twitch' ? 'live' : 'discord',
                    targetPlatform === 'twitch' ? targetChannel : undefined,
                ),
            };
        }

        const resolvedTargetTenantId = targetTenantId!;
        const broadcasterChannel = await getTenantBroadcasterChannel(resolvedTargetTenantId);
        const [directTwitchLive, liveLookup] = await Promise.all([
            getTwitchChannelLiveStatus(broadcasterChannel),
            lookupDiscordStreamHubTwitchTarget(broadcasterChannel).catch(() => null),
        ]);
        // Either live source is enough to attempt delivery. DSH announcements
        // and its clip lookup can update at different moments, while Helix can
        // also fail transiently; a positive result from either must win.
        const twitchIsLive = directTwitchLive === true || liveLookup?.isLive === true;
        const targetDiscordConfig = await readDiscordConfig(resolvedTargetTenantId).catch(() => null);
        const linkedDiscordUserId = String(targetDiscordConfig?.discordUserId || '').trim();
        const linkedDiscordGuildId = String(targetDiscordConfig?.guildId || '').trim();
        const discordPresence = linkedDiscordUserId
            ? await lookupDiscordRelayPresence(linkedDiscordUserId, linkedDiscordGuildId || undefined).catch(() => null)
            : null;
        console.log('[Dispatcher] Bot relay delivery target resolved:', {
            targetTenantId: resolvedTargetTenantId,
            broadcasterChannel,
            targetBot: input.target.currentName,
            liveLookup,
            directTwitchLive,
            twitchIsLive,
            linkedDiscordUserId: linkedDiscordUserId || null,
            discordPresence: discordPresence ? {
                inVoice: discordPresence.inVoice,
                recentlyChatting: discordPresence.recentlyChatting,
                preferredKind: discordPresence.preferredKind,
                preferredChannelId: discordPresence.preferredChannelId,
            } : null,
            firstDelivery: twitchIsLive ? 'twitch-chat' : (discordPresence?.preferredChannelId ? `discord-${discordPresence.preferredKind || 'active'}` : 'discord-dm'),
        });
        const relayText = await buildRelayDeliveryMessage({
            sourceUserName: input.sourceUserName,
            speaker: input.speaker,
            target: input.target,
            relayMessage: input.relayMessage,
            targetAudienceName: broadcasterChannel,
            targetTenantId: resolvedTargetTenantId,
            deliveryMode: 'live',
            includeReplyInstructions: false,
        });
        const relayHistory = appendRelayHistory(input.history, {
            senderUsername: input.sourceUserName,
            botName: input.speaker.currentName,
            message: relayText,
        });
        const twitchRelayText = input.humanDirected
            ? `${relayText} ${buildRelayReplyInstructions(input.sourceUserName)}`.trim()
            : relayText;

        let chatDelivered = false;
        let chatError = '';
        if (twitchIsLive) {
            try {
                await sendTwitchChatMessage(twitchRelayText, 'bot', broadcasterChannel, resolvedTargetTenantId);
                chatDelivered = true;
                await recordReplyPath({
                    platform: 'twitch',
                    channelId: broadcasterChannel,
                    defaultRecipientUsername: broadcasterChannel,
                    history: relayHistory,
                }).catch((error) => console.warn('[Dispatcher] Failed to record Twitch relay reply path:', error));
            } catch (error: any) {
                chatError = error?.message || 'unknown Twitch chat error';
                console.warn('[Dispatcher] Bot relay live Twitch delivery failed; continuing to Discord fallbacks:', {
                    targetTenantId: resolvedTargetTenantId,
                    broadcasterChannel,
                    targetBot: input.target.currentName,
                    error: chatError,
                });
            }
        }

        if (chatDelivered) {
            await appendPublicChatMessages([{
                type: 'ai',
                username: input.target.currentName,
                message: twitchRelayText,
                timestamp: new Date().toISOString(),
            }], 300, resolvedTargetTenantId).catch(() => {});

            recordDashboardActivity({
                id: `relay-${Date.now()}`,
                tenantId: resolvedTargetTenantId,
                platform: 'Twitch',
                user: input.target.currentName,
                message: `${input.speaker.currentName} relayed: ${input.relayMessage}`,
            });
            return {
                delivered: true,
                mode: 'live',
                history: relayHistory,
                summary: relayDeliverySummary(input.target.currentName, 'live', broadcasterChannel),
            };
        }

        let discordDelivered = false;
        let discordError = '';
        try {
            const presenceChannelId = String(discordPresence?.preferredChannelId || '').trim();
            const idLastSeen = linkedDiscordUserId
                ? await findDiscordLastSeenForUserId(linkedDiscordUserId).catch(() => null)
                : null;
            const nameLastSeen = !idLastSeen
                ? await findDiscordLastSeenForNames([
                    broadcasterChannel,
                    input.target.currentName,
                    ...(input.target.aliases || []),
                    ...(input.target.previousNames || []),
                ]).catch(() => null)
                : null;
            const fallbackLastSeen = idLastSeen || nameLastSeen;
            const fallbackAgeMs = fallbackLastSeen?.lastSeenAt
                ? Date.now() - new Date(fallbackLastSeen.lastSeenAt).getTime()
                : Number.POSITIVE_INFINITY;
            const recentFallback = fallbackLastSeen && fallbackAgeMs >= 0 && fallbackAgeMs <= 10 * 60 * 1000
                ? fallbackLastSeen
                : null;
            const discordLastSeen = presenceChannelId
                ? {
                    userId: linkedDiscordUserId || discordPresence?.userId,
                    username: discordPresence?.username || targetDiscordConfig?.discordUsername,
                    displayName: discordPresence?.displayName || targetDiscordConfig?.discordUsername,
                    guildId: discordPresence?.guildId || linkedDiscordGuildId,
                    channelId: presenceChannelId,
                    channelName: discordPresence?.preferredChannelName || undefined,
                    tenantId: resolvedTargetTenantId,
                    lastSeenAt: discordPresence?.voiceObservedAt || discordPresence?.lastChatAt || new Date().toISOString(),
                }
                : recentFallback;
            if (!discordLastSeen?.channelId) {
                throw new Error(`${input.target.currentName} is not currently active in Discord`);
            }
            const discordText = await buildRelayDeliveryMessage({
                sourceUserName: input.sourceUserName,
                speaker: input.speaker,
                target: input.target,
                relayMessage: input.relayMessage,
                targetAudienceName: discordLastSeen.displayName || discordLastSeen.username || broadcasterChannel,
                targetTenantId: resolvedTargetTenantId,
                deliveryMode: 'discord',
                includeReplyInstructions: false,
            });
            const discordHistory = appendRelayHistory(input.history, {
                senderUsername: input.sourceUserName,
                botName: input.speaker.currentName,
                message: discordText,
            });
            const discordMessageId = await sendDiscordRelayCard({
                channelId: discordLastSeen.channelId,
                recipientUserId: discordLastSeen.userId,
                tenantId: resolvedTargetTenantId,
                bot: input.target,
                history: discordHistory,
            });
            discordDelivered = true;
            await recordReplyPath({
                platform: 'discord',
                channelId: discordLastSeen.channelId,
                defaultRecipientUsername: discordLastSeen.displayName || discordLastSeen.username || broadcasterChannel,
                defaultRecipientUserId: discordLastSeen.userId,
                messageId: discordMessageId,
                history: discordHistory,
            }).catch((error) => console.warn('[Dispatcher] Failed to record Discord relay reply path:', error));
        } catch (error: any) {
            discordError = error?.message || 'unknown Discord last-seen error';
            console.warn('[Dispatcher] Bot relay Discord last-seen backup failed:', {
                targetTenantId: resolvedTargetTenantId,
                targetBot: input.target.currentName,
                error: discordError,
            });
        }

        let dmDelivered = false;
        let dmError = '';
        if (!discordDelivered) try {
            const dmChannelId = await getTenantDiscordDmChannelId(resolvedTargetTenantId);
            if (!dmChannelId) {
                throw new Error(`${input.target.currentName} does not have a DM channel configured`);
            }
            const dmText = chatDelivered
                ? await buildRelayDeliveryMessage({
                    sourceUserName: input.sourceUserName,
                    speaker: input.speaker,
                    target: input.target,
                    relayMessage: input.relayMessage,
                    targetAudienceName: broadcasterChannel,
                    targetTenantId: resolvedTargetTenantId,
                    deliveryMode: 'dm',
                    includeReplyInstructions: false,
                })
                : relayText;
            const discordConfig = await readDiscordConfig(resolvedTargetTenantId).catch(() => null);
            const dmHistory = appendRelayHistory(input.history, {
                senderUsername: input.sourceUserName,
                botName: input.speaker.currentName,
                message: dmText,
            });
            const dmMessageId = await sendDiscordRelayCard({
                channelId: dmChannelId,
                recipientUserId: discordConfig?.discordUserId,
                tenantId: resolvedTargetTenantId,
                bot: input.target,
                history: dmHistory,
                isPrivate: true,
            });
            dmDelivered = true;
            await recordReplyPath({
                platform: 'discord',
                channelId: dmChannelId,
                defaultRecipientUsername: discordConfig?.discordUsername || broadcasterChannel,
                defaultRecipientUserId: discordConfig?.discordUserId,
                messageId: dmMessageId,
                isPrivate: true,
                history: dmHistory,
            }).catch((error) => console.warn('[Dispatcher] Failed to record DM relay reply path:', error));
        } catch (error: any) {
            dmError = error?.message || 'unknown Discord DM error';
            console.warn('[Dispatcher] Bot relay DM backup failed:', {
                targetTenantId: resolvedTargetTenantId,
                targetBot: input.target.currentName,
                error: dmError,
            });
        }

        if (chatDelivered || discordDelivered || dmDelivered) {
            await appendPublicChatMessages([{
                type: 'ai',
                username: input.target.currentName,
                message: relayText,
                timestamp: new Date().toISOString(),
            }], 300, resolvedTargetTenantId).catch(() => {});

            recordDashboardActivity({
                id: `relay-${Date.now()}`,
                tenantId: resolvedTargetTenantId,
                platform: chatDelivered && !discordDelivered ? 'Twitch' : 'Discord',
                user: input.target.currentName,
                message: `${input.speaker.currentName} relayed: ${input.relayMessage}`,
            });

            const mode = discordDelivered ? 'discord' : chatDelivered ? 'live' : 'dm';
            return {
                delivered: true,
                mode,
                summary: relayDeliverySummary(input.target.currentName, mode, mode === 'live' ? broadcasterChannel : undefined),
            };
        }

        const error = chatError || discordError || dmError || `could not deliver to ${input.target.currentName}`;
        return { delivered: false, error, summary: relayDeliverySummary(input.target.currentName, undefined, undefined, error) };
    } catch (error: any) {
        console.error('[Dispatcher] Bot relay delivery failed:', error);
        const detail = error?.message || 'unknown error';
        return { delivered: false, error: detail, summary: relayDeliverySummary(input.target.currentName, undefined, undefined, detail) };
    }
}

export async function handleBotRelayReply(input: {
    sourcePlatform: 'twitch' | 'discord';
    sourceChannelId: string;
    sourceContextTenantId?: string;
    sourceUserName: string;
    sourceUserId?: string;
    sourceMessageId?: string;
    sourceDiscordIsPrivate?: boolean;
    speaker: WorldLoreCharacter;
    speakerTenantId?: string;
    message: string;
    botNames?: string[];
}): Promise<{
    matched: boolean;
    delivered?: boolean;
    closed?: boolean;
    missingMessage?: boolean;
    targetName?: string;
    cardUpdated?: boolean;
    error?: string;
}> {
    const command = extractRelayReplyCommand({
        message: input.message,
        botNames: input.botNames,
    });
    if (!command.matched) return { matched: false };

    const thread = await getLatestRelayReplyThread({
        recipientContextTenantId: input.sourceContextTenantId,
        platform: input.sourcePlatform,
        channelId: input.sourceChannelId,
        recipientUsername: input.sourceUserName,
        recipientUserId: input.sourceUserId,
    });
    if (!thread) return { matched: true, error: 'no-pending-relay' };

    if (command.action === 'close') {
        const cardUpdated = input.sourcePlatform === 'discord' && thread.delivery.messageId
            ? await updateDiscordRelayCard({
                channelId: input.sourceChannelId,
                messageId: thread.delivery.messageId,
                tenantId: input.speakerTenantId,
                bot: thread.recipientBot,
                histor{zë»h‘éì¶»§q«^v7WFT†V$ÖT÷WD&÷D7F–öâ‡°¢ââæ7F–öä&6RÀ¢7F–öã¢v†ÖòæÖVF–ç&WVW7BrÀ¢6W76–öä–BÀ¢VW'“¢&wVÖVçBÀ¢Ò“°¢6öç7BF—FÆRÒ&W7VÇCòç&WVW7Còæ—FVÓòçF—FÆRÇÂ&wVÖVçC°¢6öç7B6öæf—&ÖF–öâÒ7G&–ær‡&W7VÇCòæÖW76vRÇÂtFFVBFòF†R#BÔ†÷W"Æ÷VævRVWVRâr’ç&WÆ6R‚õ²åÒ²BòÂrr“°¢v—B&WÇ’†)ÈR#BÔ†÷W"Æ÷VævS¢G·F—FÆWÒ(	BG¶6öæf—&ÖF–öçÒæÂv&÷Br’æ6F6‚‚‚’Óâ·Ò“°¢Ò6F6‚†W'&÷"’°¢v—B&WÇ”f–ÇW&R†W'&÷"“°¢Ğ¢&WGW&ã°¢Ğ ¢–b†6öÖÖæBÓÓÒvçrÇÂ6öÖÖæBÓÓÒvæ÷wÆ––ærr’°¢G'’°¢6öç7B¶×W6–2ÂÖ÷f–UÓ¢ç•µÒÒv—B&öÖ—6RæÆÂ…°¢&VE6W76–öâ‚vF—66÷&BÖ×W6–2×&ööÒr’À¢&VE6W76–öâ‚vF—66÷&B×vF6‚×&ööÒr’À¢Ò“°¢6öç7B7VÖÖ&–W2Ò°¢×W6–3òç6W76–öãòæ7W'&VçCòæ—FVÓòçF—FÆP¢ò×W6–3¢G¶×W6–2ç6W76–öâæ7W'&VçBæ—FVÒçF—FÆWÒ‚G¶×W6–2ç6W76–öâçÆ–&6³òç7FGW2ÇÂw&VG’wÒÂG¶×W6–2ç6W76–öâçVWVSòæÆVæwF‚ÇÂÒVWVVB– ¢¢v×W6–3¢V×G’rÀ¢Ö÷f–Sòç6W76–öãòæ7W'&VçCòæ—FVÓòçF—FÆP¢òÖ÷f–W3¢G¶Ö÷f–Rç6W76–öâæ7W'&VçBæ—FVÒçF—FÆWÒ‚G¶Ö÷f–Rç6W76–öâçÆ–&6³òç7FGW2ÇÂw&VG’wÒÂG¶Ö÷f–Rç6W76–öâçVWVSòæÆVæwF‚ÇÂÒVWVVB– ¢¢vÖ÷f–W3¢V×G’rÀ¢Ó°¢v—B&WÇ’†)knûˆò†V$ÖT÷WB(	BG·7VÖÖ&–W2æ¦ö–â‚r+rr—ÖÂv&÷Br’æ6F6‚‚‚’Óâ·Ò“°¢Ò6F6‚†W'&÷"’°¢v—B&WÇ”f–ÇW&R†W'&÷"“°¢Ğ¢&WGW&ã°¢Ğ ¢–b‚6ä6öçG&öÄ†V$ÖT÷WB’°¢v—B&WÇ’†G¶7GVÅW6W&æÖWÒÂöæÇ’F†R'&öF67FW"÷"ÖöFW&F÷"6âW6RG¶6öÖÖæGÒæÂv&÷Br’æ6F6‚‚‚’Óâ·Ò“°¢&WGW&ã°¢Ğ¢6öç7B&WVW7FVDÆæRÒõâƒó¦×W6–7Ç6öæwÇ6öæw2’Bö’çFW7B†&wVÖVçB’òv×W6–2p¢¢õâƒó¦Ö÷f–WÆÖ÷f–W7Çf–FV÷ÇvF6‚’Bö’çFW7B†&wVÖVçB’òvÖ÷f–Rp¢¢çVÆÃ°¢6öç7B—4ÆæU7v—F6‚Ò²v×W6–2rÂw6öæw2rÂvÖ÷f–RrÂvÖ÷f–W2uÒæ–æ6ÇVFW2†6öÖÖæB“°¢6öç7BF&vWDÆæRÒ—4ÆæU7v—F6€¢ò†6öÖÖæBÓÓÒv×W6–2rÇÂ6öÖÖæBÓÓÒw6öæw2ròv×W6–2r¢vÖ÷f–Rr¢¢&WVW7FVDÆæS°¢6öç7B6öçG&öÂÒ—4ÆæU7v—F6‚ÇÂ6öÖÖæBÓÓÒwÆ’ròwÆ’p¢¢6öÖÖæBÓÓÒw7F÷ròwW6Rp¢¢6öÖÖæBÓÓÒw6¶—rÇÂ6öÖÖæBÓÓÒvæW‡BròvæW‡Bp¢¢6öÖÖæC°¢6öç7BfÇVRÒ6öÖÖæBÓÓÒwföÇVÖRròçVÖ&W"†&wVÖVçB’¢VæFVf–æVC°¢–b†6öÖÖæBÓÓÒwföÇVÖRrbb‚&wVÖVçBÇÂçVÖ&W"æ—4f–æ—FR‡fÇVR’ÇÂfÇVRÂÇÂfÇVRâ’’°¢v—B&WÇ’†G¶7GVÅW6W&æÖWÒÂW6vS¢föÇVÖRÓÂv&÷Br’æ6F6‚‚‚’Óâ·Ò“°¢&WGW&ã°¢Ğ¢v—B&WÇ’†	ù:G¶7GVÅW6W&æÖWÒÂG¶6öÖÖæGÒ&V6V—fVB(	BÇ––ær—BFò†V$ÖT÷WBæÂv&÷Br’æ6F6‚‚‚’Óâ·Ò“°¢G'’°¢6öç7B¶×W6–2ÂÖ÷f–UÓ¢ç•µÒÒv—B&öÖ—6RæÆÂ…°¢&VE6W76–öâ‚vF—66÷&BÖ×W6–2×&ööÒr’À¢&VE6W76–öâ‚vF—66÷&B×vF6‚×&ööÒr’À¢Ò“°¢6öç7B6W76–öç2Ò°¢²ÆæS¢v×W6–2rÂ6W76–öä–C¢vF—66÷&BÖ×W6–2×&ööÒrÂ7FFS¢×W6–3òç6W76–öâÒÀ¢²ÆæS¢vÖ÷f–RrÂ6W76–öä–C¢vF—66÷&B×vF6‚×&ööÒrÂ7FFS¢Ö÷f–Sòç6W76–öâÒÀ¢Ó°¢6öç7B÷&FW&VBÒ²ââç6W76–öç5Òç6÷'B‚†ÆVgBÂ&–v‡B’Óâ°¢6öç7BÆVgEÆ––ærÒÆVgBç7FFSòçÆ–&6³òç7FGW2ÓÓÒwÆ––ærrò¢°¢6öç7B&–v‡EÆ––ærÒ&–v‡Bç7FFSòçÆ–&6³òç7FGW2ÓÓÒwÆ––ærrò¢°¢–b†ÆVgEÆ––ærÓÒ&–v‡EÆ––ær’&WGW&â&–v‡EÆ––ærÒÆVgEÆ––æs°¢&WGW&âçVÖ&W"‡&–v‡Bç7FFSòçÆ–&6³òçWFFVDBÇÂ’ÒçVÖ&W"†ÆVgBç7FFSòçÆ–&6³òçWFFVDBÇÂ“°¢Ò“°¢6öç7B6VÆV7FVBÒF&vWDÆæP¢ò6W76–öç2æf–æB‚†VçG'’’ÓâVçG'’æÆæRÓÓÒF&vWDÆæR’¢¢÷&FW&VBæf–æB‚†VçG'’’ÓâVçG'’ç7FFSòæ7W'&VçB’ÇÂ6W76–öç5³Ó°¢6öç7B6W76–öä–BÒ6VÆV7FVBç6W76–öä–C° ¢–b†—4ÆæU7v—F6‚’°¢6öç7B÷F†W"Ò6W76–öç2æf–æB‚†VçG'’’ÓâVçG'’ç6W76–öä–BÓÒ6W76–öä–B“°¢–b†÷F†W#òç7FFSòæ7W'&VçBbb÷F†W"ç7FFSòçÆ–&6³òç7FGW2ÓÓÒwÆ––ærr’°¢v—BW†V7WFT†V$ÖT÷WD&÷D7F–öâ‡°¢ââæ7F–öä&6RÀ¢7F–öã¢v†ÖòæÖVF–æ6öçG&öÂrÀ¢6W76–öä–C¢÷F†W"ç6W76–öä–BÀ¢6öçG&öÃ¢wW6RrÀ¢Ò“°¢Ğ¢Ğ¢6öç7B&W7VÇC¢ç’Òv—BW†V7WFT†V$ÖT÷WD&÷D7F–öâ‡°¢ââæ7F–öä&6RÀ¢7F–öã¢v†ÖòæÖVF–æ6öçG&öÂrÀ¢6W76–öä–BÀ¢6öçG&öÂÀ¢fÇVRÀ¢Ò“°¢6öç7BF—FÆRÒ&W7VÇCòç6W76–öãòæ7W'&VçCòæ—FVÓòçF—FÆRÇÂvÖVF–Æ–W"s°¢6öç7BÆæTÆ&VÂÒ6VÆV7FVBæÆæRÓÓÒv×W6–2ròv×W6–2r¢vÖ÷f–W2s°¢v—B&WÇ’†)ÈR†V$ÖT÷WBG¶ÆæTÆ&VÇÒG¶6öçG&öÇÒG¶6öÖÖæBÓÓÒwföÇVÖRròG·fÇVWÒV¢rwÓ¢G·F—FÆWÒæÂv&÷Br’æ6F6‚‚‚’Óâ·Ò“°¢Ò6F6‚†W'&÷"’°¢v—B&WÇ”f–ÇW&R†W'&÷"“°¢Ğ¢&WGW&ã°¢Ğ ¢òò†æFÆR&–26öÖÖæBÒÆ–v‡FW"F†VgBG&6¶W"†vÆö&Â7&÷72ÆÂ7G&V×2¢–b†7GVÄÖW76vRçFôÆ÷vW$66R‚’ç7F'G5v—F‚‚r&–2r’’°¢6öç7B&w2Ò7GVÄÖW76vRç7V'7G&–ærƒB’çG&–Ò‚“°¢G'’°¢6öç7B²vWD&–4FFÂ7FVÄÆ–v‡FW"Â&VÖ÷fTÆ–v‡FW"ÂvWEf–7F–ÔÆ—7BÂ—4&Æ6¶Æ—7FVBÂFEFô&Æ6¶Æ—7BÂ&VÖ÷fTg&öÔ&Æ6¶Æ—7BÒÒ&WV—&R‚râö&–2×7F÷&vRr“° ¢òò&–2†æò&w2’÷"&–2Æ—7B·vUÒÒ6†÷rv–æFVBÆVFW&&ö&@¢–b‚&w2ÇÂ&w2çFôÆ÷vW$66R‚’ç7F'G5v—F‚‚vÆ—7Br’’°¢6öç7BFFÒvWD&–4FF‚“°¢6öç7Bf–7F–×2ÒvWEf–7F–ÔÆ—7B‚“°¢–b‡f–7F–×2æÆVæwF‚ÓÓÒ’²v—B&WÇ’†æòÆ–v‡FW'2†fR&VVâ7FöÆVâ–WBÂv&÷Br’æ6F6‚‚‚’Óâ·Ò“²&WGW&ã²Ğ¢6öç7BtUõ4•¤RÒ°¢6öç7BvT&rÒ&w2ò'6T–çB†&w2ç&WÆ6R‚õæÆ—7EÇ2¢ö’Ârr’’¢°¢6öç7BvRÒ†—4æâ‡vT&r’ÇÂvT&rÂ’ò¢vT&s°¢6öç7BF÷FÅvW2ÒÖF‚æ6V–Â‡f–7F–×2æÆVæwF‚òtUõ4•¤R“°¢6öç7BvUf–7F–×2Òf–7F–×2ç6Æ–6R‚‡vRÒ’¢tUõ4•¤RÂvR¢tUõ4•¤R“°¢6öç7BÆ—7BÒvUf–7F–×2æÖ‚‡c¢²æÖS¢7G&–æs²6÷VçC¢çVÖ&W"Ò’ÓâG·bææÖWÓ¢G·bæ6÷VçGÖ’æ¦ö–â‚rÂr“°¢ÆWBW&Å'BÒrs°¢G'’°¢6öç7B²vWD6öæf–wW&VDW&ÂÒÒ&WV—&R‚rââöÆ–"÷'VçF–ÖRÖ÷&–v–âr“°¢6öç7BgVÆÅW&ÂÒG¶vWD6öæf–wW&VDW&Â‚—Òö’ö&–2ÖÆ—7F°¢G'’²6öç7BF–ç•&W2Òv—BfWF6‚†‡GG3¢ò÷F–ç—W&Âæ6öÒö’Ö7&VFRç‡÷W&ÃÒG¶Væ6öFUU$”6ö×öæVçB†gVÆÅW&Â—ÖÂ²6–væÃ¢&÷'E6–væÂçF–ÖV÷WBƒ3’Ò“²–b‡F–ç•&W2æö²’²6öç7B6†÷'BÒv—BF–ç•&W2çFW‡B‚“²–b‡6†÷'Bç7F'G5v—F‚‚v‡GGr’’W&Å'BÒÂgVÆÂÆ—7C¢G·6†÷'GÖ²ÒÒ6F6‚·Ğ¢–b‚W&Å'B’W&Å'BÒÂgVÆÂÆ—7C¢G¶gVÆÅW&ÇÖ°¢Ò6F6‚·Ğ¢6öç7BvU'BÒF÷FÅvW2âò‡rG·vWÒòG·F÷FÅvW7Ò(	B&–2Æ—7BG·vR²Ò–¢rs°¢v—B&WÇ’†	ùJRG¶FFçF÷FÇÒÆ–v‡FW'27FöÆVâf–7F–×3¢G¶Æ—7GÒG·vU'GÒG·W&Å'GÖÂv&÷Br’æ6F6‚‚‚’Óâ·Ò“°¢&WGW&ã°¢Ğ¢òò&–2&VÖ÷fRW6W ¢–b†&w2çFôÆ÷vW$66R‚’ç7F'G5v—F‚‚w&VÖ÷fRr’’°¢–b‚‡Fw2æÖöBÇÂFw2æ&FvW3òæ'&öF67FW"’’²v—B&WÇ’†G¶7GVÅW6W&æÖWÒÂöæÇ’ÖöG26â&VÖ÷fR&–2VçG&–W2Âv&÷Br’æ6F6‚‚‚’Óâ·Ò“²&WGW&ã²Ğ¢6öç7B&VÖ÷fUF&vWBÒ&w2ç7V'7G&–ærƒr’çG&–Ò‚’ç&WÆ6R‚trÂrr’çFôÆ÷vW$66R‚“°¢–b‚&VÖ÷fUF&vWB’²v—B&WÇ’†G¶7GVÅW6W&æÖWÒÂW6vS¢&–2&VÖ÷fRW6W&Âv&÷Br’æ6F6‚‚‚’Óâ·Ò“²&WGW&ã²Ğ¢6öç7B²F÷FÂÂW6W$6÷VçBÒÒ&VÖ÷fTÆ–v‡FW"‡&VÖ÷fUF&vWB“°¢v—B&WÇ’†&VÖ÷fVBÆ–v‡FW"g&öÒG·&VÖ÷fUF&vWGÒâF÷FÃ¢G·F÷FÇÒÂG·&VÖ÷fUF&vWGÓ¢G·W6W$6÷VçGÖÂv&÷Br’æ6F6‚‚‚’Óâ·Ò“°¢6öç7B²V&Æ—6„&–4÷fW&Æ’ÒÒ&WV—&R‚râö&–2×6W'f–6Rr“°¢v—BV&Æ—6„&–4÷fW&Æ’‡²F÷FÂÂÆ7EW6W#¢&VÖ÷fUF&vWBÂÆ7EW6W$6÷VçC¢W6W$6÷VçBÒ“°¢&WGW&ã°¢Ğ¢òò&–2&Æ6¶Æ—7BW6W ¢–b†&w2çFôÆ÷vW$66R‚’ç7F'G5v—F‚‚v&Æ6¶Æ—7Br’’°¢–b‚‡Fw2æÖöBÇÂFw2æ&FvW3òæ'&öF67FW"’’²v—B&WÇ’†G¶7GVÅW6W&æÖWÒÂöæÇ’ÖöG26âÖævRF†R&–2&Æ6¶Æ—7BÂv&÷Br’æ6F6‚‚‚’Óâ·Ò“²&WGW&ã²Ğ¢6öç7B&ÅF&vWBÒ&w2ç7V'7G&–ærƒ’çG&–Ò‚’ç&WÆ6R‚trÂrr’çFôÆ÷vW$66R‚“°¢–b‚&ÅF&vWB’²v—B&WÇ’†G¶7GVÅW6W&æÖWÒÂW6vS¢&–2&Æ6¶Æ—7BW6W&Âv&÷Br’æ6F6‚‚‚’Óâ·Ò“²&WGW&ã²Ğ¢–b†FEFô&Æ6¶Æ—7B†&ÅF&vWB’’v—B&WÇ’†G¶&ÅF&vWGÒFFVBFò&–2&Æ6¶Æ—7FÂv&÷Br’æ6F6‚‚‚’Óâ·Ò“°¢VÇ6Rv—B&WÇ’†G¶&ÅF&vWGÒ—2Ç&VG’&Æ6¶Æ—7FVFÂv&÷Br’æ6F6‚‚‚’Óâ·Ò“°¢&WGW&ã°¢Ğ¢òò&–2Væ&Æ6¶Æ—7BW6W ¢–b†&w2çFôÆ÷vW$66R‚’ç7F'G5v—F‚‚wVæ&Æ6¶Æ—7Br’’°¢–b‚‡Fw2æÖöBÇÂFw2æ&FvW3òæ'&öF67FW"’’²v—B&WÇ’†G¶7GVÅW6W&æÖWÒÂöæÇ’ÖöG26âÖævRF†R&–2&Æ6¶Æ—7BÂv&÷Br’æ6F6‚‚‚’Óâ·Ò“²&WGW&ã²Ğ¢6öç7BV&ÅF&vWBÒ&w2ç7V'7G&–ærƒ"’çG&–Ò‚’ç&WÆ6R‚trÂrr’çFôÆ÷vW$66R‚“°¢–b‚V&ÅF&vWB’²v—B&WÇ’†G¶7GVÅW6W&æÖWÒÂW6vS¢&–2Væ&Æ6¶Æ—7BW6W&Âv&÷Br’æ6F6‚‚‚’Óâ·Ò“²&WGW&ã²Ğ¢–b‡&VÖ÷fTg&öÔ&Æ6¶Æ—7B‡V&ÅF&vWB’’v—B&WÇ’†G·V&ÅF&vWGÒ&VÖ÷fVBg&öÒ&–2&Æ6¶Æ—7FÂv&÷Br’æ6F6‚‚‚’Óâ·Ò“°¢VÇ6Rv—B&WÇ’†G·V&ÅF&vWGÒ—2æ÷B&Æ6¶Æ—7FVFÂv&÷Br’æ6F6‚‚‚’Óâ·Ò“°¢&WGW&ã°¢Ğ¢òò&–2W6W"Ò7FVÂÆ–v‡FW ¢6öç7BF&vWEW6W"Ò&w2ç&WÆ6R‚trÂrr’çFôÆ÷vW$66R‚“°¢–b†—4&Æ6¶Æ—7FVB‡F&vWEW6W"’’²v—B&WÇ’†G¶7GVÅW6W&æÖWÒÂG·F&vWEW6W'Ò—2&÷FV7FVBg&öÒÆ–v‡FW"F†VgBÂv&÷Br’æ6F6‚‚‚’Óâ·Ò“²&WGW&ã²Ğ¢6öç7B²F÷FÂÂW6W$6÷VçBÒÒ7FVÄÆ–v‡FW"‡F&vWEW6W"“°¢v—B&WÇ’†	ùJRfF¶–CFWcB†27FöÆVâG·F÷FÇÒÆ–v‡FW'2ÂöbF†÷6RG·W6W$6÷VçGÒ†fR&VVâG·F&vWEW6W'Òw6Âv&÷Br’æ6F6‚‚‚’Óâ·Ò“°¢6öç7B²V&Æ—6„&–4÷fW&Æ’ÒÒ&WV—&R‚râö&–2×6W'f–6Rr“°¢v—BV&Æ—6„&–4÷fW&Æ’‡²F÷FÂÂÆ7EW6W#¢F&vWEW6W"ÂÆ7EW6W$6÷VçC¢W6W$6÷VçBÒ“°¢òòæ÷F–g’fF¶–Bw27G&VÒ&÷WBF†RÆ–v‡FW"F†Vg@¢–b‡FVæçD–BÓÒssSs#sccS2r’°¢6VæD6†DÖW76vR†	ùJRfF¶–CFWcB7FöÆRG·F&vWEW6W'Òw2Æ–v‡FW"‚G·F÷FÇÒF÷FÂ7FöÆVâÂG·W6W$6÷VçGÒg&öÒG·F&vWEW6W'Ò–Âv&÷BrÂVæFVf–æVBÂssSs#sccS2r’æ6F6‚‚‚’Óâ·Ò“°¢Ğ¢Ò6F6‚†W'"’°¢6öç6öÆRæW'&÷"‚u´&–5ÒW'&÷#¢rÂW'"“°¢Ğ¢&WGW&ã°¢Ğ¢ ¢–b†7GVÄÖW76vRçFôÆ÷vW$66R‚’ç7F'G5v—F‚‚r6òr’’°¢6öç7BF&vWDæÖRÒ7GVÄÖW76vRç7V'7G&–ærƒB’çG&–Ò‚’ç&WÆ6R‚trÂrr“°¢–b‡F&vWDæÖR’°¢6öç6öÆRæÆör†´F—7F6†W%Ò&ö6W76–ær6ò6†÷WF÷WBf÷"G·F&vWDæÖWÖ“°¢–æ7&VÖVçDÖWG&–2‚w6†÷WF÷WG4v—fVârÂÂFVæçD–B’æ6F6‚‚‚’Óâ·Ò“°¢6öç7B&öf–ÆT–ÖvRÒ‡GG3¢ò÷7FF–2Ö6Fâæ§GfçrææWBö§Ge÷W6W%÷–7GW&W2òG·F&vWDæÖWÒ×&öf–ÆUö–ÖvRÓ3ƒ3çæv°¢v—B†æFÆUvÆ´öå6†÷WF÷WB‡F&vWDæÖRÂF&vWDæÖRÂ&öf–ÆT–ÖvRÂG'VRÂFVæçD–B’æ6F6‚†W'"Óâ°¢6öç6öÆRæW'&÷"‚u´F—7F6†W%Ò6ò6†÷WF÷WBf–ÆVC¢rÂW'"“°¢&WÇ’†G¶7GVÅW6W&æÖWÒÂ6†÷WF÷WBf–ÆVC¢G¶W'"æÖW76vWÖÂv&÷Br’æ6F6‚‚‚’Óâ·Ò“°¢Ò“°¢Ğ¢&WGW&ã°¢Ğ¢  ¢òòG&F–ær—26VÆV7FVB–âF†Rö¼:–FW‚'&÷w6W#²F†R&W7VÇF–ær7v6öÖÖæ@¢òò7F–ÆÂW&f÷&×2F†R6W'fW"×6–FRFöÖ–26&BW†6†ævRà¢–b†7GVÄÖW76vRçFôÆ÷vW$66R‚’ç7F'G5v—F‚‚rG&FRr’’°¢6öç7BF&vWEW6W"Ò7GVÄÖW76vRç7V'7G&–ær‚rG&FRræÆVæwF‚’çG&–Ò‚’ç&WÆ6R‚õäòÂrr“°¢6öç7Bö¶VFW…W&ÂÒ'V–ÆEö¶VÖöä'&÷w6W%W&Â†7GVÅW6W&æÖRÂF&vWEW6W"ò²G&FUv—Fƒ¢F&vWEW6W"Ò¢·Ò“°¢v—B&WÇ’€¢F&vWEW6W ¢òG¶7GVÅW6W&æÖWÒÂG&FRv—F‚G·F&vWEW6W'Òg&öÒ–÷W"ö¼:–FWƒ¢G·ö¶VFW…W&ÇÖ ¢¢G¶7GVÅW6W&æÖWÒÂ6†ö÷6RÆ–W"æB6&G2g&öÒ–÷W"ö¼:–FWƒ¢G·ö¶VFW…W&ÇÖÀ¢v'&öF67FW"rÀ¢’æ6F6‚‚‚’Óâ·Ò“°¢&WGW&ã°¢Ğ ¢òò†æFÆRöffW"6öÖÖæB…ö¶VÖöâG&FR¢–b†7GVÄÖW76vRçFôÆ÷vW$66R‚’ç7F'G5v—F‚‚röffW"r’’°¢6öç7B6&D–FVçF–f–W"Ò7GVÄÖW76vRç7V'7G&–ærƒr’çG&–Ò‚“°¢6öç7B²öffW$6&BÒÒ&WV—&R‚râ÷ö¶VÖöâ×G&FRÖÖævW"r“°¢v—BöffW$6&B†7GVÅW6W&æÖRÂ6&D–FVçF–f–W"ÂFVæçD–B“°¢&WGW&ã°¢Ğ¢ ¢òò†æFÆR66WB6öÖÖæB†6†V6²7v2f—'7BÂF†Vâö¶VÖöâG&FR¢–b†7GVÄÖW76vRçFôÆ÷vW$66R‚’ÓÓÒr66WBr’°¢6öç7B²66WE7vÂ†5VæF–æu7vÒÒ&WV—&R‚râ÷ö¶VÖöâ×7vr“°¢–b††5VæF–æu7v†7GVÅW6W&æÖRÂFVæçD–B’’°¢v—B66WE7v†7GVÅW6W&æÖRÂFVæçD–B“°¢&WGW&ã°¢Ğ¢6öç7B²66WEG&FRÒÒ&WV—&R‚râ÷ö¶VÖöâ×G&FRÖÖævW"r“°¢v—B66WEG&FR†7GVÅW6W&æÖRÂFVæçD–B“°¢&WGW&ã°¢Ğ¢ ¢òò†æFÆR6æ6VÂ6öÖÖæB†6†V6²7v2f—'7BÂF†Vâö¶VÖöâG&FR¢–b†7GVÄÖW76vRçFôÆ÷vW$66R‚’ÓÓÒr6æ6VÂr’°¢6öç7B²6æ6VÅ7vÂ†5VæF–æu7vÒÒ&WV—&R‚râ÷ö¶VÖöâ×7vr“°¢–b††5VæF–æu7v†7GVÅW6W&æÖRÂFVæçD–B’’°¢v—B6æ6VÅ7v†7GVÅW6W&æÖRÂFVæçD–B“°¢&WGW&ã°¢Ğ¢6öç7B²6æ6VÅG&FRÒÒ&WV—&R‚râ÷ö¶VÖöâ×G&FRÖÖævW"r“°¢v—B6æ6VÅG&FR†7GVÅW6W&æÖRÂFVæçD–B“°¢&WGW&ã°¢Ğ¢ ¢òò†æFÆR7v6öÖÖæB(	BöæR×6†÷BG&FR&÷÷6À¢–b†7GVÄÖW76vRçFôÆ÷vW$66R‚’ç7F'G5v—F‚‚r7vr’’°¢6öç7B'G2Ò7GVÄÖW76vRç7V'7G&–ærƒb’çG&–Ò‚’æÖF6‚‚õäò…Å2²•Ç2²…ÆB²•Ç2¶f÷%Ç2²…ÆB²’Bö’“°¢–b‚'G2’°¢v—B&WÇ’†G¶7GVÅW6W&æÖWÒÂW6vS¢7vW6W"Ç–÷W"6&B3âf÷"ÇF†V—"6&B3æÂv'&öF67FW"r’æ6F6‚‚‚’Óâ·Ò“°¢&WGW&ã°¢Ğ¢6öç7BF&vWEW6W"Ò'G5³Òç&WÆ6R‚trÂrr“°¢6öç7B×”6&BÒ'6T–çB‡'G5³%Ò“°¢6öç7BF†V—$6&BÒ'6T–çB‡'G5³5Ò“°¢–b‡F&vWEW6W"çFôÆ÷vW$66R‚’ÓÓÒ7GVÅW6W&æÖRçFôÆ÷vW$66R‚’’°¢v—B&WÇ’†G¶7GVÅW6W&æÖWÒÂ–÷R6âwB7vv—F‚–÷W'6VÆbÂv'&öF67FW"r’æ6F6‚‚‚’Óâ·Ò“°¢&WGW&ã°¢Ğ¢6öç7B²&÷÷6U7vÒÒ&WV—&R‚râ÷ö¶VÖöâ×7vr“°¢v—B&÷÷6U7v†7GVÅW6W&æÖRÂF&vWEW6W"Â×”6&BÂF†V—$6&BÂFVæçD–B“°¢&WGW&ã°¢Ğ ¢òò†æFÆRFV6²6öÖÖæBÒf–Wr6fVBFV6°¢–b†7GVÄÖW76vRçFôÆ÷vW$66R‚’ÓÓÒrFV6²r’°¢6öç7B²vWEW6W$6öÆÆV7F–öâÒÒ&WV—&R‚râ÷ö¶VÖöâ×7F÷&vRÖF—66÷&Br“°¢6öç7B6öÂÒv—BvWEW6W$6öÆÆV7F–öâ†7GVÅW6W&æÖR“°¢–b‚6öÂæFV6²ÇÂ6öÂæFV6²æ6&G3òæÆVæwF‚’°¢v—B&WÇ’†G¶7GVÅW6W&æÖWÒÂ–÷RFöâwB†fRFV6²–WBâW6RF†RöµÇSS–FW‚FV6²'V–ÆFW"æB6WFFV6²Fò6fRöæRæÂv'&öF67FW"r’æ6F6‚‚‚’Óâ·Ò“°¢&WGW&ã°¢Ğ¢6öç7B²vWEW6W$6&G2ÒÒ&WV—&R‚râ÷ö¶VÖöâÖ6öÆÆV7F–öâr“°¢6öç7B6&G2Òv—BvWEW6W$6&G2†7GVÅW6W&æÖR“°¢6öç7BæÖW2Ò6öÂæFV6²æ6&G2ç6Æ–6RƒÂ‚’æÖ‚†–Gƒ¢çVÖ&W"’Óâ6&G5¶–G‚ÒÓòææÖRÇÂsòr’æ¦ö–â‚rÂr“°¢6öç7BVæW&w•7G"Òö&¦V7BæVçG&–W2†6öÂæFV6²æVæW&w’ÇÂ·Ò’æf–ÇFW"‚…²ÂåÒ’Óâ†â2çVÖ&W"’â’æÖ‚…·BÂåÒ’ÓâG¶çÒG·GÖ’æ¦ö–â‚rÂr“°¢6öç7BF÷FÂÒ6öÂæFV6²æ6&G2æÆVæwF‚²ö&¦V7BçfÇVW2†6öÂæFV6²æVæW&w’ÇÂ·Ò’ç&VGV6R‚†¢çVÖ&W"Â#¢ç’’Óâ²çVÖ&W"†"’Â“°¢v—B&WÇ’†G¶7GVÅW6W&æÖWÒw2FV6²‚G·F÷FÇÒóC“¢G¶æÖW7ÒG¶6öÂæFV6²æ6&G2æÆVæwF‚â‚òrâââr¢rwÒG¶VæW&w•7G"òrÂVæW&w“¢r²VæW&w•7G"¢rwÖÂv'&öF67FW"r’æ6F6‚‚‚’Óâ·Ò“°¢&WGW&ã°¢Ğ ¢òò†æFÆR6WFFV6²6öÖÖæBÒ6fRCÖ6&BFV6²g&öÒ&6Sc@¢–b†7GVÄÖW76vRçFôÆ÷vW$66R‚’ç7F'G5v—F‚‚r6WFFV6²r’’°¢6öç7BVæ6öFVBÒ7GVÄÖW76vRç7V'7G&–ærƒ’’çG&–Ò‚“°¢G'’°¢6öç7BFV6öFVBÒ¥4ôâç'6R„'VffW"æg&öÒ†Væ6öFVBÂv&6ScBr’çFõ7G&–ær‚wWFbÓ‚r’“°¢–b‚FV6öFVBæ6&G2ÇÂ'&’æ—4'&’†FV6öFVBæ6&G2’’F‡&÷ræWrW'&÷"‚v&Bf÷&ÖBr“°¢6öç7BVæW&w“¢&V6÷&CÇ7G&–ærÂçVÖ&W#âÒFV6öFVBæVæW&w’ÇÂ·Ó°¢6öç7BVæW&w•F÷FÂÒö&¦V7BçfÇVW2†VæW&w’’ç&VGV6R‚†¢çVÖ&W"Â#¢ç’’Óâ²çVÖ&W"†"’Â“°¢6öç7BF÷FÂÒFV6öFVBæ6&G2æÆVæwF‚²VæW&w•F÷FÃ°¢–b‡F÷FÂÓÒC’°¢v—B&WÇ’†G¶7GVÅW6W&æÖWÒÂFV6²×W7B&RW†7FÇ’C6&G2†v÷BG·F÷FÇÒ’æÂv'&öF67FW"r’æ6F6‚‚‚’Óâ·Ò“°¢&WGW&ã°¢Ğ¢6öç7B²vWEW6W$6&G2ÒÒ&WV—&R‚râ÷ö¶VÖöâÖ6öÆÆV7F–öâr“°¢6öç7B6&G2Òv—BvWEW6W$6&G2†7GVÅW6W&æÖR“°¢6öç7B–çfÆ–BÒFV6öFVBæ6&G2æf–æB‚†–Gƒ¢çVÖ&W"’Óâ6&G5¶–G‚ÒÒ“°¢–b†–çfÆ–B’°¢v—B&WÇ’†G¶7GVÅW6W&æÖWÒÂ6&B2G¶–çfÆ–GÒFöW6âwBW†—7B–â–÷W"6öÆÆV7F–öâÂv'&öF67FW"r’æ6F6‚‚‚’Óâ·Ò“°¢&WGW&ã°¢Ğ¢6öç7B²vWEW6W$6öÆÆV7F–öâÂ6fUW6W$6öÆÆV7F–öâÒÒ&WV—&R‚râ÷ö¶VÖöâ×7F÷&vRÖF—66÷&Br“°¢6öç7B6öÂÒv—BvWEW6W$6öÆÆV7F–öâ†7GVÅW6W&æÖR“°¢6öÂæFV6²Ò²6&G3¢FV6öFVBæ6&G2ÂVæW&w’Ó°¢v—B6fUW6W$6öÆÆV7F–öâ†7GVÅW6W&æÖRÂ6öÂ“°¢6öç7Bö¶VÖöä6÷VçBÒFV6öFVBæ6&G2æf–ÇFW"‚†–Gƒ¢çVÖ&W"’Óâ°¢6öç7B2Ò6&G5¶–G‚ÒÓ°¢G'’°¢6öç7B6WDFFÒ¥4ôâç'6R‡&WV—&R‚vg2r’ç&VDf–ÆU7–æ2‡&WV—&R‚wF‚r’æ¦ö–â‡&ö6W72æ7vB‚’Âwö¶VÖöâ×F6rÖFFÖÖ7FW"rÂv6&G2rÂvVârÂG¶2ç6WD6öFWÒæ§6öæ’ÂwWFbÓ‚r’“°¢6öç7BF6rÒ6WDFFæf–æB‚‡C¢ç’’ÓâBæçVÖ&W"ÓÓÒ2æçVÖ&W"“°¢&WGW&âF6sòç7WW'G—RÓÓÒuöµÇSS–Ööâs°¢Ò6F6‚²&WGW&âfÇ6S²Ğ¢Ò’æÆVæwFƒ°¢v—B&WÇ’†G¶7GVÅW6W&æÖWÒÂFV6²6fVBG¶FV6öFVBæ6&G2æÆVæwF‡Ò6&G2²G¶VæW&w•F÷FÇÒVæW&w’‚G·ö¶VÖöä6÷VçGÒöµÇSS–Ööâ’æÂv'&öF67FW"r’æ6F6‚‚‚’Óâ·Ò“°¢Ò6F6‚°¢v—B&WÇ’†G¶7GVÅW6W&æÖWÒÂ–çfÆ–BFV6²6öFRâW6RF†RöµÇSS–FW‚FV6²'V–ÆFW"FòvVæW&FRöæRæÂv'&öF67FW"r’æ6F6‚‚‚’Óâ·Ò“°¢Ğ¢&WGW&ã°¢Ğ ¢òò†æFÆRw–×FVÒ6öÖÖæBÒ6WB26&G2f÷"w–Ò&GFÆW0¢–b†7GVÄÖW76vRçFôÆ÷vW$66R‚’ç7F'G5v—F‚‚rw–×FVÒr’’°¢6öç7B&w2Ò7GVÄÖW76vRç7V'7G&–ærƒ‚’çG&–Ò‚’ç7Æ—B‚õÇ2²ò“°¢–b†&w2æÆVæwF‚ÓÒ2ÇÂ&w2ç6öÖR†Óâæ–æ6ÇVFW2‚rÒr’’’°¢v—B&WÇ’†G¶7GVÅW6W&æÖWÒÂW6vS¢w–×FVÒÇ6WBÖçVÓâÇ6WBÖçVÓâÇ6WBÖçVÓâ†Rærâw–×FVÒ&6SÓB&6SbÓ2w–Ó"ÓR–Âv'&öF67FW"r’æ6F6‚‚‚’Óâ·Ò“°¢&WGW&ã°¢Ğ¢6öç7B²vWEW6W$6&G2ÒÒ&WV—&R‚râ÷ö¶VÖöâÖ6öÆÆV7F–öâr“°¢6öç7B6&G2Òv—BvWEW6W$6&G2†7GVÅW6W&æÖR“°¢6öç7BÖF6†VBÒ&w2æÖ‚†–C¢7G&–ær’Óâ6&G2æf–æB‚†3¢ç’’ÓâG¶2ç6WD6öFWÒÒG¶2æçVÖ&W'ÖÓÓÒ–B’“°¢6öç7BÖ—76–ærÒ&w2æf–ÇFW"‚…ó¢7G&–ærÂ“¢çVÖ&W"’ÓâÖF6†VE¶•Ò“°¢–b†Ö—76–æræÆVæwF‚’°¢v—B&WÇ’†G¶7GVÅW6W&æÖWÒÂ6&B‡2’æ÷Bf÷VæB–â–÷W"6öÆÆV7F–öã¢G¶Ö—76–æræ¦ö–â‚rÂr—ÖÂv'&öF67FW"r’æ6F6‚‚‚’Óâ·Ò“°¢&WGW&ã°¢Ğ¢òòfW&–g’ÆÂ&Rö¶VÖöà¢6öç7Bg2Ò&WV—&R‚vg2r“°¢6öç7BF‚Ò&WV—&R‚wF‚r“°¢6öç7B4$E5ôD•"ÒF‚æ¦ö–â‡&ö6W72æ7vB‚’Âwö¶VÖöâ×F6rÖFFÖÖ7FW"rÂv6&G2rÂvVâr“°¢f÷"†6öç7B2öbÖF6†VB’°¢G'’°¢6öç7B6WDFFÒ¥4ôâç'6R†g2ç&VDf–ÆU7–æ2‡F‚æ¦ö–â„4$E5ôD•"ÂG¶2ç6WD6öFWÒæ§6öæ’ÂwWFbÓ‚r’“°¢6öç7BF6rÒ6WDFFæf–æB‚‡C¢ç’’ÓâBæçVÖ&W"ÓÓÒ2æçVÖ&W"“°¢–b‡F6rbbF6rç7WW'G—RÓÒuöµÇSS–Ööâr’°¢v—B&WÇ’†G¶7GVÅW6W&æÖWÒÂG¶2ææÖWÒ‚G¶2ç6WD6öFWÒÒG¶2æçVÖ&W'Ò’—2æ÷BöµÇSS–ÖöâÂv'&öF67FW"r’æ6F6‚‚‚’Óâ·Ò“°¢&WGW&ã°¢Ğ¢Ò6F6‚·Ğ¢Ğ¢6öç7B²6WDw–ÕFVÒÒÒ&WV—&R‚râöw–Ò×FVÒr“°¢v—B6WDw–ÕFVÒ†7GVÅW6W&æÖRÂ&w2“°¢6öç7BæÖW2ÒÖF6†VBæÖ‚†3¢ç’’ÓâG¶2ææÖWÒ‚G¶2ç6WD6öFWÒÒG¶2æçVÖ&W'Ò–’æ¦ö–â‚rÂr“°¢v—B&WÇ’†G¶7GVÅW6W&æÖWÒÂw–ÒFVÒ6WC¢G¶æÖW7ÖÂv'&öF67FW"r’æ6F6‚‚‚’Óâ·Ò“°¢&WGW&ã°¢Ğ ¢òò†æFÆR6†ÆÆVævR6öÖÖæB„w–Ò&GFÆRVWVR¢–b†7GVÄÖW76vRçFôÆ÷vW$66R‚’ÓÓÒr6†ÆÆVævRr’°¢6öç7B²¦ö–åVWVRÒÒ&WV—&R‚râöw–ÒÖ&GFÆRr“°¢v—B¦ö–åVWVR†7GVÅW6W&æÖRÂFVæçD–B“°¢&WGW&ã°¢Ğ¢   ¢òò†æFÆRFW7G7v6öÖÖæB†ÖöBÖöæÇ’(	B&÷÷6RæBWFòÖ66WB7vf÷"÷fW&Æ’FW7F–ær¢–b†7GVÄÖW76vRçFôÆ÷vW$66R‚’ÓÓÒrFW7G7vr’°¢–b‡Fw2æÖöBÇÂFw2æ&FvW3òæ'&öF67FW"’°¢6öç7B²&÷÷6U7vÂ66WE7vÒÒ&WV—&R‚râ÷ö¶VÖöâ×7vr“°¢v—B&÷÷6U7v†7GVÅW6W&æÖRÂv¶†—FVFG’rÂÂÂFVæçD–B“°¢6WEF–ÖV÷WB†7–æ2‚’Óâ°¢v—B66WE7v‚v¶†—FVFG’rÂFVæçD–B“°¢ÒÂS“°¢Ğ¢&WGW&ã°¢Ğ ¢òò†æFÆRFW7Fw–Ò6öÖÖæB†ÖöBÖöæÇ’FW7B&GFÆR¢–b†7GVÄÖW76vRçFôÆ÷vW$66R‚’ÓÓÒrFW7Fw–Òr’°¢–b‡Fw2æÖöBÇÂFw2æ&FvW3òæ'&öF67FW"’°¢6öç7B²FW7Dw–Ô&GFÆRÒÒ&WV—&R‚râöw–ÒÖ&GFÆRr“°¢v—BFW7Dw–Ô&GFÆR‡FVæçD–B“°¢Ğ¢&WGW&ã°¢Ğ ¢òò†æFÆRæW‡F6†ÆÆVævW"6öÖÖæB…7G&VÖW"7F'G2æW‡B&GFÆR¢–b†7GVÄÖW76vRçFôÆ÷vW$66R‚’ÓÓÒræW‡F6†ÆÆVævW"r’°¢–b‡Fw2æÖöBÇÂFw2æ&FvW3òæ'&öF67FW"’°¢6öç7B²7F'DæW‡D&GFÆRÒÒ&WV—&R‚râöw–ÒÖ&GFÆRr“°¢v—B7F'DæW‡D&GFÆR‡FVæçD–B“°¢ÒVÇ6R°¢v—B&WÇ’†G¶7GVÅW6W&æÖWÒÂöæÇ’F†Rw–ÒÆVFW"6â7F'B&GFÆW2Âv'&öF67FW"r’æ6F6‚‚‚’Óâ·Ò“°¢Ğ¢&WGW&ã°¢Ğ¢ ¢òò†æFÆRGF6²6öÖÖæB„w–Ò&GFÆR¢–b†7GVÄÖW76vRçFôÆ÷vW$66R‚’ÓÓÒrGF6²r’°¢6öç7B²&GFÆTGF6²ÒÒ&WV—&R‚râöw–ÒÖ&GFÆRr“°¢v—B&GFÆTGF6²†7GVÅW6W&æÖRÂFVæçD–B“°¢&WGW&ã°¢Ğ¢ ¢òò†æFÆR7v—F6‚6öÖÖæB„w–Ò&GFÆR¢–b†7GVÄÖW76vRçFôÆ÷vW$66R‚’ÓÓÒr7v—F6‚r’°¢6öç7B²&GFÆU7v—F6‚ÒÒ&WV—&R‚râöw–ÒÖ&GFÆRr“°¢v—B&GFÆU7v—F6‚†7GVÅW6W&æÖRÂFVæçD–B“°¢&WGW&ã°¢Ğ¢ ¢òò†æFÆR6Æ—6öÖÖæ@¢–b†7GVÄÖW76vRçFôÆ÷vW$66R‚’ÓÓÒr6Æ—r’°¢G'’°¢6öç7BFVæçEVW'’ÒFVæçD–Bò÷FVæçD–CÒG¶Væ6öFUU$”6ö×öæVçB‡FVæçD–B—Ö¢rs°¢6öç7B&W7öç6RÒv—BfWF6‚†‡GG¢òó#rããã¢G·&ö6W72æVçbåõ%GÇÃ3Òö’÷Gv—F6‚ö7&VFRÖ6Æ—G·FVæçEVW'—ÖÂ°¢ÖWF†öC¢uõ5BrÀ¢†VFW'3¢–çFW&æÅ6W'f–6T†VFW'2‚’À¢6–væÃ¢&÷'E6–væÂçF–ÖV÷WBƒ’À¢Ò“°¢6öç7BFFÒv—B&W7öç6Ræ§6öâ‚’æ6F6‚‚‚’ÓâçVÆÂ“°¢–b‡&W7öç6Ræö²’°¢6öç7B6Æ—W&ÂÒFFòçW&ÂÇÂFFòæ6Æ—òæVF—E÷W&ÂÇÂ†FFòæ6Æ—òæ–Bò‡GG3¢òö6Æ—2çGv—F6‚çGbòG¶FFæ6Æ—æ–GÖ¢rr“°¢–b†6Æ—W&Â’°¢v—B&WÇ’†	ù;’6Æ—7&VFVBG¶6Æ—W&ÇÖÂv'&öF67FW"r’æ6F6‚‚‚’Óâ·Ò“°¢ÒVÇ6R°¢v—B&WÇ’†G¶7GVÅW6W&æÖWÒÂ6Æ—7&VFVB'WBæòU$Â&WGW&æVBÂv'&öF67FW"r’æ6F6‚‚‚’Óâ·Ò“°¢Ğ¢ÒVÇ6R°¢6öç7BGv—F6„W'&÷"ÒFFòæFWF–Ç3òçGv—F6„W'&÷#°¢6öç7BGv—F6„ÖW76vRÒG—VöbGv—F6„W'&÷"ÓÓÒw7G&–ærp¢òGv—F6„W'&÷ ¢¢Gv—F6„W'&÷#òæÖW76vRÇÂGv—F6„W'&÷#òæW'&÷"ÇÂFFòæW'&÷"ÇÂuVæ¶æ÷vâW'&÷"s°¢6öç6öÆRæW'&÷"‚u´F—7F6†W%Ò6Æ—7&VF–öâf–ÆVC¢rÂ&W7öç6Rç7FGW2ÂFFÇÂGv—F6„ÖW76vR“°¢v—B&WÇ’†G¶7GVÅW6W&æÖWÒÂf–ÆVBFò7&VFR6Æ—¢G·Gv—F6„ÖW76vWÒ‚G·&W7öç6Rç7FGW7Ò–Âv'&öF67FW"r’æ6F6‚‚‚’Óâ·Ò“°¢Ğ¢Ò6F6‚†W'&÷"’°¢6öç6öÆRæW'&÷"‚u´F—7F6†W%Ò6Æ—7&VF–öâf–ÆVC¢rÂW'&÷"“°¢v—B&WÇ’†G¶7GVÅW6W&æÖWÒÂ6Æ—7&VF–öâF–ÖVB÷WB÷"f–ÆVBÂv'&öF67FW"r’æ6F6‚‚‚’Óâ·Ò“°¢Ğ¢&WGW&ã°¢Ğ¢  ¢òò†æFÆRföÆÆ÷vvR6öÖÖæ@¢–b†7GVÄÖW76vRçFôÆ÷vW$66R‚’ç7F'G5v—F‚‚rföÆÆ÷vvRr’’°¢6öç7B&w2Ò7GVÄÖW76vRç7V'7G&–ærƒ’çG&–Ò‚“°¢6öç7BF&vWEW6W"Ò†&w2ò&w2¢7GVÅW6W&æÖR¢ç&WÆ6R‚õä²òÂrr¢ç&WÆ6R‚õµæ×¤Õ£Ó•õÒörÂrr¢çFôÆ÷vW$66R‚“°¢–b‚F&vWEW6W"’°¢v—B&WÇ’†G¶7GVÅW6W&æÖWÒÂ&÷f–FRfÆ–BGv—F6‚W6W&æÖRæÂv&÷Br’æ6F6‚‚‚’Óâ·Ò“°¢&WGW&ã°¢Ğ¢ ¢G'’°¢6öç7B²vWDföÆÆ÷tvRÒÒ&WV—&R‚râ÷Gv—F6‚r“°¢6öç7BföÆÆ÷tFFÒv—BvWDföÆÆ÷tvR‡F&vWEW6W"ÂFVæçD–B“° ¢–b†föÆÆ÷tFFòæföÆÆ÷vVDB’°¢6öç7BföÆÆ÷tFFRÒæWrFFR†föÆÆ÷tFFæföÆÆ÷vVDB“°¢6öç7Bæ÷rÒæWrFFR‚“°¢6öç7BF–fd×2Òæ÷rævWEF–ÖR‚’ÒföÆÆ÷tFFRævWEF–ÖR‚“°¢6öç7BF—2ÒÖF‚æfÆö÷"†F–fd×2òƒ¢c¢c¢#B’“°¢6öç7B–V'2ÒÖF‚æfÆö÷"†F—2ò3cR“°¢6öç7BÖöçF‡2ÒÖF‚æfÆö÷"‚†F—2R3cR’ò3“°¢6öç7B&VÖ–æ–ætF—2ÒF—2R3°¢ ¢ÆWBF–ÖU7G"Òrs°¢–b‡–V'2â’F–ÖU7G"³ÒG·–V'7×’°¢–b†ÖöçF‡2â’F–ÖU7G"³ÒG¶ÖöçF‡7ÖÒ°¢F–ÖU7G"³ÒG·&VÖ–æ–ætF—7ÖF°¢ ¢v—B&WÇ’†G·F&vWEW6W'Ò†2&VVâföÆÆ÷v–ærf÷"G·F–ÖU7G'ÒÂv&÷Br’æ6F6‚‚‚’Óâ·Ò“°¢ÒVÇ6R–b†föÆÆ÷tFFbbföÆÆ÷tFFæföÆÆ÷vVDB’°¢v—B&WÇ’†G·F&vWEW6W'Ò—2æ÷BföÆÆ÷v–ærÂv&÷Br’æ6F6‚‚‚’Óâ·Ò“°¢ÒVÇ6R°¢v—B&WÇ’†G¶7GVÅW6W&æÖWÒÂ6÷VÆFâwBfW&–g’föÆÆ÷r7FGW2&–v‡Bæ÷râG'’v–â–âÖöÖVçBæÂv&÷Br’æ6F6‚‚‚’Óâ·Ò“°¢Ğ¢Ò6F6‚†W'&÷"’°¢v—B&WÇ’†G¶7GVÅW6W&æÖWÒÂ6÷VÆFâwBfWF6‚föÆÆ÷rFFÂv&÷Br’æ6F6‚‚‚’Óâ·Ò“°¢Ğ¢&WGW&ã°¢Ğ¢ ¢òò†æFÆRföÆÆ÷vVB6öÖÖæ@¢–b†7GVÄÖW76vRçFôÆ÷vW$66R‚’ÓÓÒrföÆÆ÷vVBr’°¢G'’°¢6öç7B²vWDföÆÆ÷tvRÒÒ&WV—&R‚râ÷Gv—F6‚r“°¢6öç7BföÆÆ÷tFFÒv—BvWDföÆÆ÷tvR†7GVÅW6W&æÖRÂFVæçD–B“°¢ ¢–b†föÆÆ÷tFFòæföÆÆ÷vVDB’°¢6öç7BföÆÆ÷tFFRÒæWrFFR†föÆÆ÷tFFæföÆÆ÷vVDB“°¢v—B&WÇ’†G¶7GVÅW6W&æÖWÒföÆÆ÷vVBöâG¶föÆÆ÷tFFRçFôÆö6ÆTFFU7G&–ær‚—ÒÂv'&öF67FW"r’æ6F6‚‚‚’Óâ·Ò“°¢ÒVÇ6R–b†föÆÆ÷tFFbbföÆÆ÷tFFæföÆÆ÷vVDB’°¢v—B&WÇ’†G¶7GVÅW6W&æÖWÒÂ–÷Rw&Ræ÷BföÆÆ÷v–ærÂv'&öF67FW"r’æ6F6‚‚‚’Óâ·Ò“°¢ÒVÇ6R°¢v—B&WÇ’†G¶7GVÅW6W&æÖWÒÂ’6÷VÆFâwBfW&–g’föÆÆ÷r7FGW2&–v‡Bæ÷râG'’v–â–âÖöÖVçBæÂv'&öF67FW"r’æ6F6‚‚‚’Óâ·Ò“°¢Ğ¢Ò6F6‚†W'&÷"’°¢v—B&WÇ’†G¶7GVÅW6W&æÖWÒÂ6÷VÆFâwBfWF6‚föÆÆ÷rFFÂv'&öF67FW"r’æ6F6‚‚‚’Óâ·Ò“°¢Ğ¢&WGW&ã°¢Ğ¢ ¢òò†æFÆRföÆÆ÷vW'26öÖÖæ@¢–b†7GVÄÖW76vRçFôÆ÷vW$66R‚’ÓÓÒrföÆÆ÷vW'2r’°¢G'’°¢6öç7B²vWD6†ææVÄ–æfòÒÒ&WV—&R‚râ÷Gv—F6‚r“°¢6öç7B–æfòÒv—BvWD6†ææVÄ–æfò‡FVæçD–B“°¢–b†–æfò’°¢v—B&WÇ’†7W'&VçBföÆÆ÷vW'3¢G¶–æfòæföÆÆ÷vW$6÷VçCòçFôÆö6ÆU7G&–ær‚’ÇÂuVæ¶æ÷vâwÖÂv'&öF67FW"r’æ6F6‚‚‚’Óâ·Ò“°¢ÒVÇ6R°¢v—B&WÇ’†G¶7GVÅW6W&æÖWÒÂ6÷VÆFâwBfWF6‚föÆÆ÷vW"6÷VçBÂv'&öF67FW"r’æ6F6‚‚‚’Óâ·Ò“°¢Ğ¢Ò6F6‚†W'&÷"’°¢6öç6öÆRæW'&÷"‚u´F—7F6†W%ÒföÆÆ÷vW'2fWF6‚f–ÆVC¢rÂW'&÷"“°¢v—B&WÇ’†G¶7GVÅW6W&æÖWÒÂ6÷VÆFâwBfWF6‚föÆÆ÷vW"6÷VçBÂv'&öF67FW"r’æ6F6‚‚‚’Óâ·Ò“°¢Ğ¢&WGW&ã°¢Ğ¢  ¢òò†æFÆRWF–ÖR6öÖÖæ@¢–b†7GVÄÖW76vRçFôÆ÷vW$66R‚’ÓÓÒrWF–ÖRr’°¢G'’°¢6öç7B²vWE7G&VÕWF–ÖRÒÒ&WV—&R‚râ÷Gv—F6‚r“°¢6öç7BWF–ÖRÒv—BvWE7G&VÕWF–ÖR‡FVæçD–B“°¢–b‡WF–ÖR’°¢v—B&WÇ’†7G&VÒWF–ÖS¢G·WF–ÖRæ†÷W'7Ö‚G·WF–ÖRæÖ–çWFW7ÖÖÂv'&öF67FW"r’æ6F6‚‚‚’Óâ·Ò“°¢ÒVÇ6R°¢v—B&WÇ’‚u7G&VÒ—2öffÆ–æRrÂv'&öF67FW"r’æ6F6‚‚‚’Óâ·Ò“°¢Ğ¢Ò6F6‚†W'&÷"’°¢6öç6öÆRæW'&÷"‚u´F—7F6†W%ÒWF–ÖRfWF6‚f–ÆVC¢rÂW'&÷"“°¢v—B&WÇ’†G¶7GVÅW6W&æÖWÒÂ6÷VÆFâwBfWF6‚WF–ÖRÂv'&öF67FW"r’æ6F6‚‚‚’Óâ·Ò“°¢Ğ¢&WGW&ã°¢Ğ¢ ¢òò†æFÆRvF6‡F–ÖR6öÖÖæ@¢–b†7GVÄÖW76vRçFôÆ÷vW$66R‚’ÓÓÒrvF6‡F–ÖRr’°¢G'’°¢6öç7B²vWEW6W"Âf÷&ÖEvF6‡F–ÖRÒÒ&WV—&R‚râ÷W6W"×7FG2r“°¢–b‚FVæçD7G‚’F‡&÷ræWrW'&÷"‚tÖ—76–ærFVæçB6öçFW‡Bf÷"vF6‡F–ÖRr“°¢6öç7BW6W"Òv—BvWEW6W"†7GVÅW6W&æÖRÂFVæçD7G‚“°¢6öç7B×6rÒf÷&ÖEvF6‡F–ÖR‡W6W"“°¢v—B&WÇ’†×6rÂv&÷Br’æ6F6‚‚‚’Óâ·Ò“°¢Ò6F6‚†W'&÷"’°¢6öç6öÆRæW'&÷"‚u´F—7F6†W%ÒvF6‡F–ÖRfWF6‚f–ÆVC¢rÂW'&÷"“°¢v—B&WÇ’†G¶7GVÅW6W&æÖWÒÂ6÷VÆFâwBfWF6‚–÷W"vF6‡F–ÖRÂv&÷Br’æ6F6‚‚‚’Óâ·Ò“°¢Ğ¢&WGW&ã°¢Ğ¢ ¢òò†æFÆR7FG26öÖÖæ@¢–b†7GVÄÖW76vRçFôÆ÷vW$66R‚’ÓÓÒr7FG2r’°¢G'’°¢6öç7B²vWD6†ææVÄ–æfòÒÒ&WV—&R‚râ÷Gv—F6‚r“°¢6öç7B–æfòÒv—BvWD6†ææVÄ–æfò‡FVæçD–B“°¢–b†–æfò’°¢v—B&WÇ’€¢	ù8¢föÆÆ÷vW'3¢G¶–æfòæföÆÆ÷vW$6÷VçCòçFôÆö6ÆU7G&–ær‚’ÇÂÒÂf–Ww3¢G¶–æfòçf–Wt6÷VçCòçFôÆö6ÆU7G&–ær‚’ÇÂÖÀ¢v&÷Bp¢’æ6F6‚‚‚’Óâ·Ò“°¢ÒVÇ6R°¢v—B&WÇ’†G¶7GVÅW6W&æÖWÒÂ6÷VÆFâwBfWF6‚7FG2Âv&÷Br’æ6F6‚‚‚’Óâ·Ò“°¢Ğ¢Ò6F6‚†W'&÷"’°¢6öç6öÆRæW'&÷"‚u´F—7F6†W%Ò7FG2fWF6‚f–ÆVC¢rÂW'&÷"“°¢v—B&WÇ’†G¶7GVÅW6W&æÖWÒÂ7FG2&WVW7BF–ÖVB÷WBÂv&÷Br’æ6F6‚‚‚’Óâ·Ò“°¢Ğ¢&WGW&ã°¢Ğ¢ ¢òò†æFÆR6WFvÖR6öÖÖæB†ÖöBö'&öF67FW"öæÇ’¢–b†7GVÄÖW76vRçFôÆ÷vW$66R‚’ç7F'G5v—F‚‚r6WFvÖRr’’°¢–b‡Fw2æÖöBÇÂFw2æ&FvW3òæ'&öF67FW"’°¢6öç7BvÖRÒ7GVÄÖW76vRç7V'7G&–ærƒ’’çG&–Ò‚“°¢G'’°¢6öç7B²WFFT6†ææVÄ–æfòÒÒ&WV—&R‚râ÷Gv—F6‚r“°¢6öç7Bö²Òv—BWFFT6†ææVÄ–æfò‡²vÖUöæÖS¢vÖRÒÂFVæçD–B“°¢–b†ö²’°¢v—B&WÇ’†	øêâvÖR6WBFó¢G¶vÖWÖÂv&÷Br’æ6F6‚‚‚’Óâ·Ò“°¢ÒVÇ6R°¢v—B&WÇ’†f–ÆVBFò6WBvÖRÂv&÷Br’æ6F6‚‚‚’Óâ·Ò“°¢Ğ¢Ò6F6‚†W'&÷"’°¢6öç6öÆRæW'&÷"‚u´F—7F6†W%Ò6WBvÖRf–ÆVC¢rÂW'&÷"“°¢v—B&WÇ’†f–ÆVBFò6WBvÖRÂv&÷Br’æ6F6‚‚‚’Óâ·Ò“°¢Ğ¢ÒVÇ6R°¢v—B&WÇ’†G¶7GVÅW6W&æÖWÒÂöæÇ’ÖöG26â6†ævRF†RvÖRÂv'&öF67FW"r’æ6F6‚‚‚’Óâ·Ò“°¢Ğ¢&WGW&ã°¢Ğ¢ ¢òò†æFÆR6WGF—FÆR6öÖÖæB†ÖöBö'&öF67FW"öæÇ’¢–b†7GVÄÖW76vRçFôÆ÷vW$66R‚’ç7F'G5v—F‚‚r6WGF—FÆRr’’°¢–b‡Fw2æÖöBÇÂFw2æ&FvW3òæ'&öF67FW"’°¢6öç7BF—FÆRÒ7GVÄÖW76vRç7V'7G&–ærƒ’çG&–Ò‚“°¢G'’°¢6öç7B²WFFT6†ææVÄ–æfòÒÒ&WV—&R‚râ÷Gv—F6‚r“°¢6öç7Bö²Òv—BWFFT6†ææVÄ–æfò‡²F—FÆRÒÂFVæçD–B“°¢–b†ö²’°¢v—B&WÇ’†	ù9ÒF—FÆR6WBFó¢G·F—FÆWÖÂv&÷Br’æ6F6‚‚‚’Óâ·Ò“°¢ÒVÇ6R°¢v—B&WÇ’†f–ÆVBFò6WBF—FÆRÂv&÷Br’æ6F6‚‚‚’Óâ·Ò“°¢Ğ¢Ò6F6‚†W'&÷"’°¢6öç6öÆRæW'&÷"‚u´F—7F6†W%Ò6WBF—FÆRf–ÆVC¢rÂW'&÷"“°¢v—B&WÇ’†f–ÆVBFò6WBF—FÆRÂv&÷Br’æ6F6‚‚‚’Óâ·Ò“°¢Ğ¢ÒVÇ6R°¢v—B&WÇ’†G¶7GVÅW6W&æÖWÒÂöæÇ’ÖöG26â6†ævRF†RF—FÆRÂv'&öF67FW"r’æ6F6‚‚‚’Óâ·Ò“°¢Ğ¢&WGW&ã°¢Ğ¢ ¢òò†æFÆR&–FÖW76vR6öÖÖæB†ÖöBö'&öF67FW"öæÇ’¢–b†7GVÄÖW76vRçFôÆ÷vW$66R‚’ç7F'G5v—F‚‚r&–FÖW76vRr’’°¢–b‡Fw2æÖöBÇÂFw2æ&FvW3òæ'&öF67FW"’°¢6öç7BÖW76vRÒ7GVÄÖW76vRç7V'7G&–ærƒ2’çG&–Ò‚“°¢òò7F÷&R&–BÖW76vP¢G'’°¢6öç7Bg57–æ2Ò&WV—&R‚vg2r“°¢6öç7BF„ÖöBÒ&WV—&R‚wF‚r“°¢6öç7B6öæf–uF‚ÒFVæçD–@¢ò&WV—&R‚rââöÆ–"÷FVæçBr’çFVæçEF‚‡FVæçD–BÂwFö¶Vç2÷&–BÖÖW76vRæ§6öâr¢¢F„ÖöBæ¦ö–â‡&ö6W72æ7vB‚’ÂwFö¶Vç2rÂw&–BÖÖW76vRæ§6öâr“°¢g57–æ2æÖ¶F—%7–æ2‡F„ÖöBæF—&æÖR†6öæf–uF‚’Â²&V7W'6—fS¢G'VRÒ“°¢g57–æ2çw&—FTf–ÆU7–æ2†6öæf–uF‚Â¥4ôâç7G&–æv–g’‡²ÖW76vRÒÂçVÆÂÂ"’“°¢v—B&WÇ’†)ÈR&–BÖW76vR6WBÂv'&öF67FW"r’æ6F6‚‚‚’Óâ·Ò“°¢Ò6F6‚†W'&÷"’°¢6öç6öÆRæW'&÷"‚u´F—7F6†W%Ò&–BÖW76vR6fRf–ÆVC¢rÂW'&÷"“°¢Ğ¢ÒVÇ6R°¢v—B&WÇ’†G¶7GVÅW6W&æÖWÒÂöæÇ’ÖöG26â6WBF†R&–BÖW76vRÂv'&öF67FW"r’æ6F6‚‚‚’Óâ·Ò“°¢Ğ¢&WGW&ã°¢Ğ¢ ¢6öç7B÷WGWD6öçFW‡BÒvWD6†D÷WGWD6öçFW‡B‚“° ¢òò†æFÆR6öÖÖæG0¢–b‚õâ6öÖÖæG2ƒó¥Ç2µ³Ó…Ò“òBö’çFW7B†7GVÄÖW76vRçG&–Ò‚’’’°¢6öç7B—4ÖöBÒ&ööÆVâ‡Fw2æÖöBÇÂFw2æ&FvW3òæ'&öF67FW"“°¢6öç7BF—&V7D6FVv÷'’ÒF—&V7DÆ÷VævT6öÖÖæD6FVv÷'’†7GVÄÖW76vRÂ—4ÖöB“°¢–b†÷WGWD6öçFW‡CòçÆFf÷&ÒÓÓÒvF—66÷&Brbb÷WGWD6öçFW‡Bæ6†ææVÄ–B’°¢–b†F—&V7D6FVv÷'’’°¢f÷"†6öç7BÆ–æRöbF—&V7D6FVv÷'’’v—B&WÇ’†Æ–æRÂv&÷Br’æ6F6‚‚‚’Óâ·Ò“°¢ÒVÇ6R°¢v—B6VæE7G'V7GW&VDF—66÷&E&WÇ’‡°¢6†ææVÄ–C¢÷WGWD6öçFW‡Bæ6†ææVÄ–BÀ¢ÖW76vS¢'V–ÆDF—66÷&D6öÖÖæG57VÖÖ'’‚’À¢FVæçD–BÀ¢F—FÆS¢u7G&VÕvVfW"F—66÷&B6öÖÖæG2rÀ¢&W7öç6UG—S¢t6öÖÖæBF—&V7F÷'’rÀ¢f–VÆG3¢'V–ÆDF—66÷&D6öÖÖæDF—&V7F÷'”f–VÆG2‚’À¢6÷W&6TÖW76vT–C¢÷WGWD6öçFW‡BæÖW76vT–BÀ¢6÷W&6TÖW76vS¢7GVÄÖW76vRÀ¢6÷W&6UW6W#¢7GVÅW6W&æÖRÀ¢6÷W&6UW6W$fF%W&Ã¢÷WGWD6öçFW‡BçW6W$fF%W&ÂÀ¢Ò’æ6F6‚‚‚’Óâ·Ò“°¢Ğ¢ÒVÇ6R°¢6öç7BÆ–æW2ÒF—&V7D6FVv÷'’ÇÂ¶&Vv–äÆ÷VævT6öÖÖæDÖVçR‡°¢ÆFf÷&Ó¢wGv—F6‚rÂFVæçD–BÂ6†ææVÄ–C¢&WÇ”6†ææVÂÂW6W&æÖS¢7GVÅW6W&æÖRÂ—4ÖöBÀ¢Ò•Ó°¢f÷"†6öç7BÆ–æRöbÆ–æW2’v—B&WÇ’†G¶7GVÅW6W&æÖWÒG¶Æ–æWÖÂv'&öF67FW"r’æ6F6‚‚‚’Óâ·Ò“°¢Ğ¢&WGW&ã°¢Ğ ¢–b†7GVÄÖW76vRçFôÆ÷vW$66R‚’ç7F'G5v—F‚‚rF–ÖV÷WBr’’°¢–b‚‡Fw2æÖöBÇÂFw2æ&FvW3òæ'&öF67FW"’’°¢v—B&WÇ’†G¶7GVÅW6W&æÖWÒÂöæÇ’ÖöG26âW6RF–ÖV÷WBæÂv'&öF67FW"r’æ6F6‚‚‚’Óâ·Ò“°¢&WGW&ã°¢Ğ ¢6öç7B6ÖD&w2Ò7GVÄÖW76vRç7V'7G&–ær‚rF–ÖV÷WBræÆVæwF‚’çG&–Ò‚’ç7Æ—B‚õÇ2²ò’æf–ÇFW"„&ööÆVâ“°¢6öç7BF&vWEW6W"Ò6ÖD&w5³Óòç&WÆ6R‚õäòÂrr’çG&–Ò‚“°¢–b‚F&vWEW6W"’°¢v—B&WÇ’†G¶7GVÅW6W&æÖWÒÂW6vS¢F–ÖV÷WBW6W"¶GW&F–öåÒ·&V6öåÖÂv'&öF67FW"r’æ6F6‚‚‚’Óâ·Ò“°¢&WGW&ã°¢Ğ ¢6öç7B'6VDGW&F–öâÒ'6UF–ÖV÷WDGW&F–öâ†6ÖD&w5³Ò“°¢6öç7B&V6öâÒ'6VDGW&F–öâæ6öç7VÖVBò6ÖD&w2ç6Æ–6Rƒ"’æ¦ö–â‚rr’¢6ÖD&w2ç6Æ–6Rƒ’æ¦ö–â‚rr“° ¢G'’°¢6öç7B²F–ÖV÷WEW6W"ÒÒ&WV—&R‚râ÷Gv—F6‚r“°¢6öç7Bö²Òv—BF–ÖV÷WEW6W"‡F&vWEW6W"Â'6VDGW&F–öâç6V6öæG2Â&V6öâÂFVæçD–B“°¢v—B&WÇ’€¢ö°¢òF–ÖVB÷WBG·F&vWEW6W'Òf÷"G·'6VDGW&F–öâç6V6öæG7×2G·&V6öâò¢G·&V6öçÖ¢râwÖ ¢¢f–ÆVBFòF–ÖV÷WBG·F&vWEW6W'ÒæÀ¢v'&öF67FW"p¢’æ6F6‚‚‚’Óâ·Ò“°¢Ò6F6‚†W'&÷"’°¢6öç6öÆRæW'&÷"‚u´F—7F6†W%ÒF–ÖV÷WBf–ÆVC¢rÂW'&÷"“°¢v—B&WÇ’†f–ÆVBFòF–ÖV÷WBG·F&vWEW6W'ÒæÂv'&öF67FW"r’æ6F6‚‚‚’Óâ·Ò“°¢Ğ¢&WGW&ã°¢Ğ¢ ¢òò†æFÆRÆVFW&&ö&B6öÖÖæG0¢–b…²rÆVFW"rÂrÆVFW&&ö&BrÂrÆVFW"rÂrvÆVFW"rÂr6ÆVFW"rÂr&ÆVFW"rÂr&—G6ÆVFW"uÒæ–æ6ÇVFW2†7GVÄÖW76vRç7Æ—B‚rr•³ÒçFôÆ÷vW$66R‚’’’°¢6öç7B&WVW7FVD6ÖBÒ7GVÄÖW76vRç7Æ—B‚rr•³ÒçFôÆ÷vW$66R‚“°¢6öç7B6ÖBÒ&WVW7FVD6ÖBÓÓÒrÆVFW&&ö&BròrÆVFW"r¢&WVW7FVD6ÖC°¢6öç7B&w2Ò7GVÄÖW76vRç7V'7G&–ær†6ÖBæÆVæwF‚’çG&–Ò‚“°¢6öç7B'&öF67DfâÒG—Vöb†vÆö&Â2ç’’æ'&öF67BÓÓÒvgVæ7F–öârò†vÆö&Â2ç’’æ'&öF67B¢‚’Óâ·Ó°¢v—B†æFÆTÆVFW&&ö&D6öÖÖæB†6ÖBÂ7GVÅW6W&æÖRÂ&w2Â'&öF67DfâÂFVæçD–BÂ7G&–ær‡Fw5²wW6W"Ö–BuÒÇÂFw2çW6W$–BÇÂrr’“°¢&WGW&ã°¢Ğ¢ ¢òò†æFÆRVWfVR6öÖÖæB(	B7V6–ÂVWfVR&ö÷7FW"f÷"Ö÷F†W&Ö—&–Và¢–b†7GVÄÖW76vRçFôÆ÷vW$66R‚’ÓÓÒrVWfVRr’°¢–b†7GVÅW6W&æÖRçFôÆ÷vW$66R‚’ÓÒvÖ÷F†W&Ö—&–Vâr’°¢v—B&WÇ’†G¶7GVÅW6W&æÖWÒÂF†—2—2Ö÷F†W&Ö—&–Vâw27V6–ÂVWfVR6²Âv'&öF67FW"r’æ6F6‚‚‚’Óâ·Ò“°¢&WGW&ã°¢Ğ¢G'’°¢6öç7B²÷VäVWfVU6²ÒÒ&WV—&R‚râ÷ö¶VÖöâ×6·2r“°¢6öç7B&W7VÇBÒv—B÷VäVWfVU6²†7GVÅW6W&æÖRÂFVæçD–B“°¢–b‡&W7VÇB’°¢6öç7B²vWEW6W$6&G2ÒÒ&WV—&R‚râ÷ö¶VÖöâÖ6öÆÆV7F–öâr“°¢6öç7BÆÄ6&G2Òv—BvWEW6W$6&G2†7GVÅW6W&æÖR“°¢6öç7B&&T6÷VçBÒÆÄ6&G2æf–ÇFW"‚†3¢ç’’Óâ2ç&&—G“òæ–æ6ÇVFW2‚u&&Rr’’æÆVæwFƒ°¢6öç7B6&D–æfòÒ&W7VÇBç6²æÖ‚†3¢ç’’ÓâG¶2ææÖWÒ‚G¶2ç&&—G—Ò–’æ¦ö–â‚rÂr“°¢v—B&WÇ’†)Ê‚G¶7GVÅW6W&æÖWÒ÷VæVBâVWfVR&ö÷7FW"G¶6&D–æf÷ÒÂF÷FÃ¢G¶ÆÄ6&G2æÆVæwF‡Ò6&G2‚G·&&T6÷VçGÒ&&R–Âv'&öF67FW"r’æ6F6‚‚‚’Óâ·Ò“°¢ÒVÇ6R°¢v—B&WÇ’†G¶7GVÅW6W&æÖWÒÂ6öÖWF†–ærvVçBw&öær÷Væ–ærF†RVWfVR6²Âv'&öF67FW"r’æ6F6‚‚‚’Óâ·Ò“°¢Ğ¢Ò6F6‚†S¢ç’’°¢6öç6öÆRæW'&÷"‚u´VWfVR6µÒW'&÷#¢rÂR“°¢Ğ¢&WGW&ã°¢Ğ  ¢òò†æFÆRFÖ–à¢–b†7GVÄÖW76vRçFôÆ÷vW$66R‚’ÓÓÒrFÖ–âr’°¢–b‡Fw2æÖöBÇÂFw2æ&FvW3òæ'&öF67FW"’°¢6öç7BFÖ–å7VÖÖ'’Ò÷WGWD6öçFW‡CòçÆFf÷&ÒÓÓÒvF—66÷&Bp¢ò'V–ÆDF—66÷&DFÖ–ä6öÖÖæG57VÖÖ'’‡²—4ÖöC¢G'VRÒ¢¢	ùJrFÖ–ã¢6òÇW6W#âÂ6WFvÖRÆvÖSâÂ6WGF—FÆRÇF—FÆSâÂ&–FÖW76vRÆ×6sâÂw&VWF–ævÖöFRÂvVÆ6öÖVÖöFRÂ6Æ—ÖöFRÂ6†FÖöFRÂ&÷G6†&RÂF†VæWfW'—v†W&RÂ'&"Â&6²Â–væ÷&RÇW6W#âÂFFfÆ÷rÇ&ö×CâÂ&÷fVfÆ÷rÂ6öÖÖæCâÂF—6&ÆVfÆ÷rÂ6öÖÖæCâÂFVÆWFVfÆ÷rÂ6öÖÖæCâs°¢v—B&WÇ’†FÖ–å7VÖÖ'’Âv'&öF67FW"r’æ6F6‚‚‚’Óâ·Ò“°¢ÒVÇ6R°¢6öç7BFVæ–VE7VÖÖ'’Ò÷WGWD6öçFW‡CòçÆFf÷&ÒÓÓÒvF—66÷&Bp¢ò'V–ÆDF—66÷&DFÖ–ä6öÖÖæG57VÖÖ'’‡²—4ÖöC¢fÇ6RÒ¢¢G¶7GVÅW6W&æÖWÒÂöæÇ’ÖöG26âf–WrFÖ–â6öÖÖæG2°¢v—B&WÇ’†FVæ–VE7VÖÖ'’Âv'&öF67FW"r’æ6F6‚‚‚’Óâ·Ò“°¢Ğ¢&WGW&ã°¢Ğ ¢–b†7GVÄÖW76vRçFôÆ÷vW$66R‚’ç7F'G5v—F‚‚rFFfÆ÷rr’’°¢–b‚Fw2æÖöBbbFw2æ&FvW3òæ'&öF67FW"’°¢v—B&WÇ’†G¶7GVÅW6W&æÖWÒÂöæÇ’ÖöG26â7&VFR’v÷&¶fÆ÷w2g&öÒ6†BæÂv'&öF67FW"r’æ6F6‚‚‚’Óâ·Ò“°¢&WGW&ã°¢Ğ ¢6öç7B&ö×BÒ7GVÄÖW76vRç7V'7G&–ær‚rFFfÆ÷rræÆVæwF‚’çG&–Ò‚“°¢–b‚&ö×B’°¢v—B&WÇ’†G¶7GVÅW6W&æÖWÒÂW6RFFfÆ÷rföÆÆ÷vVB'’v†BF†Rv÷&¶fÆ÷r6†÷VÆBFòâW†×ÆS¢FFfÆ÷rÖ¶Rvò7F'BRÖ–çWFR6÷VçFF÷væÂv'&öF67FW"r’æ6F6‚‚‚’Óâ·Ò“°¢&WGW&ã°¢Ğ ¢G'’°¢6öç7B²7&VFUv÷&¶fÆ÷tg&öÕ&ö×BÒÒv—B–×÷'B‚râöWFöÖF–öâö’×v÷&¶fÆ÷rÖ'V–ÆFW"r“°¢6öç7B7&VFVBÒv—B7&VFUv÷&¶fÆ÷tg&öÕ&ö×B‡°¢ÖW76vS¢&ö×BÀ¢FVæçD–BÀ¢W6W$æÖS¢7GVÅW6W&æÖRÀ¢Ò“°¢6öç7B6öÖÖæDÆ&VÂÒ7&VFVBæ6öÖÖæEFW‡BÇÂ†7&VFVBæ6öÖÖæBò7G&–ær†7&VFVBæ6öÖÖæBæ6öÖÖæBÇÂrr’¢rr“°¢6öç7B&Wf–Wtæ÷FRÒ7&VFVBç&WV—&W5&Wf–Wp¢ò—B–æ6ÇVFW2&öw&ÖÖ&ÆR7FWÂ6ò&Wf–Wr—B&Vf÷&RVæ&Æ–æræ ¢¢rs°¢v—B&WÇ’€¢G¶7&VFVBæ7F–öâææÖWÒG&gFVBG¶6öÖÖæDÆ&VÂòf÷"G¶6öÖÖæDÆ&VÇÖ¢rwÒâ—B—26fVBF—6&ÆVBâG·&Wf–Wtæ÷FWÒW6R&÷fVfÆ÷rG¶6öÖÖæDÆ&VÂÇÂsÂ6öÖÖæCâwÒFòVæ&ÆR—B÷"VF—B—B–âv÷&¶fÆ÷w2æÀ¢v'&öF67FW"p¢’æ6F6‚‚‚’Óâ·Ò“°¢Ò6F6‚†W'&÷#¢ç’’°¢6öç6öÆRæW'&÷"‚u´F—7F6†W%ÒFFfÆ÷rf–ÆVC¢rÂW'&÷"“°¢v—B&WÇ’†G¶7GVÅW6W&æÖWÒÂ’fÆ÷r7&VF–öâf–ÆVC¢G¶W'&÷#òæÖW76vRÇÂwVæ¶æ÷vâW'&÷"wÖÂv'&öF67FW"r’æ6F6‚‚‚’Óâ·Ò“°¢Ğ¢&WGW&ã°¢Ğ ¢–b†7GVÄÖW76vRçFôÆ÷vW$66R‚’ç7F'G5v—F‚‚r&÷fVfÆ÷rr’’°¢–b‚Fw2æÖöBbbFw2æ&FvW3òæ'&öF67FW"’°¢v—B&WÇ’†G¶7GVÅW6W&æÖWÒÂöæÇ’ÖöG26âVæ&ÆR’v÷&¶fÆ÷w2g&öÒ6†BæÂv'&öF67FW"r’æ6F6‚‚‚’Óâ·Ò“°¢&WGW&ã°¢Ğ ¢6öç7B6öÖÖæEFW‡BÒ7GVÄÖW76vRç7V'7G&–ær‚r&÷fVfÆ÷rræÆVæwF‚’çG&–Ò‚“°¢–b‚6öÖÖæEFW‡B’°¢v—B&WÇ’†G¶7GVÅW6W&æÖWÒÂW6R&÷fVfÆ÷rÂ6öÖÖæCâæÂv'&öF67FW"r’æ6F6‚‚‚’Óâ·Ò“°¢&WGW&ã°¢Ğ ¢G'’°¢6öç7B²6WEv÷&¶fÆ÷tVæ&ÆVD'”6öÖÖæBÒÒv—B–×÷'B‚râöWFöÖF–öâö’×v÷&¶fÆ÷rÖ'V–ÆFW"r“°¢6öç7BWFFVBÒv—B6WEv÷&¶fÆ÷tVæ&ÆVD'”6öÖÖæB†6öÖÖæEFW‡BÂG'VRÂFVæçD–B“°¢v—B&WÇ’†Væ&ÆVBv÷&¶fÆ÷rf÷"G¶6öÖÖæEFW‡GÒâWFFVBG·WFFVBæÆ–æ¶VD7F–öç2æÆVæwF‡ÒÆ–æ¶VB7F–öâ‡2’æÂv'&öF67FW"r’æ6F6‚‚‚’Óâ·Ò“°¢Ò6F6‚†W'&÷#¢ç’’°¢6öç6öÆRæW'&÷"‚u´F—7F6†W%Ò&÷fVfÆ÷rf–ÆVC¢rÂW'&÷"“°¢v—B&WÇ’†G¶7GVÅW6W&æÖWÒÂ6÷VÆFâwBVæ&ÆRG¶6öÖÖæEFW‡GÓ¢G¶W'&÷#òæÖW76vRÇÂwVæ¶æ÷vâW'&÷"wÖÂv'&öF67FW"r’æ6F6‚‚‚’Óâ·Ò“°¢Ğ¢&WGW&ã°¢Ğ ¢–b†7GVÄÖW76vRçFôÆ÷vW$66R‚’ç7F'G5v—F‚‚rF—6&ÆVfÆ÷rr’’°¢–b‚Fw2æÖöBbbFw2æ&FvW3òæ'&öF67FW"’°¢v—B&WÇ’†G¶7GVÅW6W&æÖWÒÂöæÇ’ÖöG26âF—6&ÆR’v÷&¶fÆ÷w2g&öÒ6†BæÂv'&öF67FW"r’æ6F6‚‚‚’Óâ·Ò“°¢&WGW&ã°¢Ğ ¢6öç7B6öÖÖæEFW‡BÒ7GVÄÖW76vRç7V'7G&–ær‚rF—6&ÆVfÆ÷rræÆVæwF‚’çG&–Ò‚“°¢–b‚6öÖÖæEFW‡B’°¢v—B&WÇ’†G¶7GVÅW6W&æÖWÒÂW6RF—6&ÆVfÆ÷rÂ6öÖÖæCâæÂv'&öF67FW"r’æ6F6‚‚‚’Óâ·Ò“°¢&WGW&ã°¢Ğ ¢G'’°¢6öç7B²6WEv÷&¶fÆ÷tVæ&ÆVD'”6öÖÖæBÒÒv—B–×÷'B‚râöWFöÖF–öâö’×v÷&¶fÆ÷rÖ'V–ÆFW"r“°¢6öç7BWFFVBÒv—B6WEv÷&¶fÆ÷tVæ&ÆVD'”6öÖÖæB†6öÖÖæEFW‡BÂfÇ6RÂFVæçD–B“°¢v—B&WÇ’†F—6&ÆVBv÷&¶fÆ÷rf÷"G¶6öÖÖæEFW‡GÒâWFFVBG·WFFVBæÆ–æ¶VD7F–öç2æÆVæwF‡ÒÆ–æ¶VB7F–öâ‡2’æÂv'&öF67FW"r’æ6F6‚‚‚’Óâ·Ò“°¢Ò6F6‚†W'&÷#¢ç’’°¢6öç6öÆRæW'&÷"‚u´F—7F6†W%ÒF—6&ÆVfÆ÷rf–ÆVC¢rÂW'&÷"“°¢v—B&WÇ’†G¶7GVÅW6W&æÖWÒÂ6÷VÆFâwBF—6&ÆRG¶6öÖÖæEFW‡GÓ¢G¶W'&÷#òæÖW76vRÇÂwVæ¶æ÷vâW'&÷"wÖÂv'&öF67FW"r’æ6F6‚‚‚’Óâ·Ò“°¢Ğ¢&WGW&ã°¢Ğ ¢–b†7GVÄÖW76vRçFôÆ÷vW$66R‚’ç7F'G5v—F‚‚rFVÆWFVfÆ÷rr’’°¢–b‚Fw2æÖöBbbFw2æ&FvW3òæ'&öF67FW"’°¢v—B&WÇ’†G¶7GVÅW6W&æÖWÒÂöæÇ’ÖöG26âFVÆWFR’v÷&¶fÆ÷w2g&öÒ6†BæÂv'&öF67FW"r’æ6F6‚‚‚’Óâ·Ò“°¢&WGW&ã°¢Ğ ¢6öç7B6öÖÖæEFW‡BÒ7GVÄÖW76vRç7V'7G&–ær‚rFVÆWFVfÆ÷rræÆVæwF‚’çG&–Ò‚“°¢–b‚6öÖÖæEFW‡B’°¢v—B&WÇ’†G¶7GVÅW6W&æÖWÒÂW6RFVÆWFVfÆ÷rÂ6öÖÖæCâæÂv'&öF67FW"r’æ6F6‚‚‚’Óâ·Ò“°¢&WGW&ã°¢Ğ ¢G'’°¢6öç7B²FVÆWFUv÷&¶fÆ÷t'”6öÖÖæBÒÒv—B–×÷'B‚râöWFöÖF–öâö’×v÷&¶fÆ÷rÖ'V–ÆFW"r“°¢6öç7BFVÆWFVBÒv—BFVÆWFUv÷&¶fÆ÷t'”6öÖÖæB†6öÖÖæEFW‡BÂFVæçD–B“°¢v—B&WÇ’†FVÆWFVBv÷&¶fÆ÷rf÷"G¶6öÖÖæEFW‡GÒâ&VÖ÷fVBG¶FVÆWFVBæÆ–æ¶VD7F–öç2æÆVæwF‡ÒÆ–æ¶VB7F–öâ‡2’æÂv'&öF67FW"r’æ6F6‚‚‚’Óâ·Ò“°¢Ò6F6‚†W'&÷#¢ç’’°¢6öç6öÆRæW'&÷"‚u´F—7F6†W%ÒFVÆWFVfÆ÷rf–ÆVC¢rÂW'&÷"“°¢v—B&WÇ’†G¶7GVÅW6W&æÖWÒÂ6÷VÆFâwBFVÆWFRG¶6öÖÖæEFW‡GÓ¢G¶W'&÷#òæÖW76vRÇÂwVæ¶æ÷vâW'&÷"wÖÂv'&öF67FW"r’æ6F6‚‚‚’Óâ·Ò“°¢Ğ¢&WGW&ã°¢Ğ¢ ¢òòâ6öÖÖæB†æFÆ–ærg&öÒ¥4ôâf–ÆW0¢6öç6öÆRæÆör†´F—7F6†W%ÒÆöö¶–ærf÷"6öÖÖæC¢G¶6ÖDæÖWÖ“°¢6öç7B6öÖÖæG2Òv—BvWDÆÄ6öÖÖæG2‡FVæçD–B“°¢6öç7B6öæf–wW&VD6öÖÖæBÒ6öÖÖæG2æf–æB‚†3¢ç’’Óâ7G&–ær†2æ6öÖÖæBÇÂrr’çFôÆ÷vW$66R‚’ç&WÆ6R‚õâòÂrr’ÓÓÒ6ÖDæÖR“°¢ ¢6öç7B6öÖÖæBÒ6öæf–wW&VD6öÖÖæBÇÂ6öÖÖæG2æf–æB‚†3¢ç’’Óâ7G&–ær†2æ6öÖÖæBÇÂrr’çFôÆ÷vW$66R‚’ç&WÆ6R‚õâòÂrr’ÓÓÒ6ÖDæÖRbb2æVæ&ÆVB“°¢ ¢–b†6öÖÖæB’°¢6öç6öÆRæÆör†´F—7F6†W%Òf÷VæB6öÖÖæC¢G¶6öÖÖæBææÖWÖ“°¢6öç6öÆRæÆör†´F—7F6†W%Ò6öÖÖæB†27F–öä–C¦Â†6öÖÖæB2ç’’æ7F–öä–B“°¢6öç6öÆRæÆör†´F—7F6†W%Ò6ÖDæÖS¢G¶6ÖDæÖWÖ“° ¢6öç7B6ÖD&w2Ò7GVÄÖW76vRç7V'7G&–ær†6ÖDæÖRæÆVæwF‚²"’çG&–Ò‚’ç7Æ—B‚õÇ2²ò’æf–ÇFW"„&ööÆVâ“°¢6öç7BF&vWE&rÒ6ÖD&w5³Óòç&WÆ6R‚trÂrr’ÇÂrs°¢6öç7BW†V4&w3¢&V6÷&CÇ7G&–ærÂç“âÒ·Ó°¢6ÖD&w2æf÷$V6‚‚†¢7G&–ærÂ“¢çVÖ&W"’Óâ²W†V4&w5¶–çWBG¶—ÖÒÒ²Ò“°¢W†V4&w2ç&t–çWBÒ6ÖD&w2æ¦ö–â‚rr“°¢W†V4&w2çFVæçD–BÒFVæçD–BÇÂrs°¢6öç7BW†V7WF–öä6öçFW‡BÒ°¢W6W#¢7GVÅW6W&æÖRÀ¢W6W$æÖS¢7GVÅW6W&æÖRÀ¢ÖW76vS¢7GVÄÖW76vRÀ¢&t–çWC¢6ÖD&w2æ¦ö–â‚rr’À¢ÆFf÷&Ó¢wGv—F6‚rÀ¢6†ææVÃ¢&WÇ”6†ææVÂÀ¢FVæçD–C¢FVæçD–BÇÂVæFVf–æVBÀ¢&w3¢W†V4&w2À¢f&–&ÆW3¢°¢W6W#¢7GVÅW6W&æÖRÀ¢W6W$æÖS¢7GVÅW6W&æÖRÀ¢6†ææVÃ¢&WÇ”6†ææVÂÀ¢FVæçD–C¢FVæçD–BÇÂrrÀ¢F&vWEW6W#¢F&vWE&rÀ¢F&vWEW6W$æÖS¢F&vWE&rÀ¢&t–çWC¢6ÖD&w2æ¦ö–â‚rr’À¢ÒÀ¢Ó° ¢6öç7B7F–öç4f÷$6öÖÖæBÒ†v—BvWDÆÄ7F–öç2‡FVæçD–B’’æf–ÇFW"‚†7F–öã¢ç’’Óà¢7F–öãòæVæ&ÆVBb`¢'&’æ—4'&’†7F–öâçG&–vvW'2’b`¢7F–öâçG&–vvW'2ç6öÖR‚‡G&–vvW#¢ç’’Óà¢G&–vvW#òæVæ&ÆVBÓÒfÇ6Rb`¢çVÖ&W"‡G&–vvW#òçG—R’ÓÓÒCb`¢7G&–ær‡G&–vvW#òæ6öÖÖæD–BÇÂrr’ÓÓÒ7G&–ær‚†6öÖÖæB2ç’’æ–BÇÂrr¢¢“° ¢–b†7F–öç4f÷$6öÖÖæBæÆVæwF‚â’°¢6öç7B²7V$7F–öäW†V7WF÷"ÒÒv—B–×÷'B‚râöWFöÖF–öâõ7V$7F–öäW†V7WF÷"r“°¢6öç7BW†V7WF÷"ÒæWr7V$7F–öäW†V7WF÷"‚“°¢f÷"†6öç7B7F–öâöb7F–öç4f÷$6öÖÖæB’°¢6öç6öÆRæÆör†´F—7F6†W%ÒW†V7WF–ær6öÖÖæB×G&–vvW&VB7F–öâG¶7F–öâæ–GÒf÷"G¶6ÖDæÖWÖ“°¢v—BW†V7WF÷"æW†V7WFT7F–öâ†7F–öâÂW†V7WF–öä6öçFW‡B“°¢Ğ¢&WGW&ã°¢Ğ¢ ¢–b‚†6öÖÖæB2ç’’æ7F–öä–Bbb—56ö6–Ä6öÖÖæDæÖR†6ÖDæÖR’’°¢6öç7BF&vWBÒ7GVÄÖW76vRç7V'7G&–ær†6ÖDæÖRæÆVæwF‚²"’çG&–Ò‚“°¢6öç7B&÷DæÖRÒvWD&÷DæÖR‡FVæçD–B“°¢6öç7B&W7öç6RÒv—BvVæW&FU6ö6–Ä6öÖÖæE&WÇ’‡°¢ÆFf÷&Ó¢wGv—F6‚rÀ¢6öÖÖæDæÖS¢6ÖDæÖRÀ¢W6W$æÖS¢7GVÅW6W&æÖRÀ¢F&vWBÀ¢FVæçD–BÀ¢&÷DæÖRÀ¢Ò“°¢–b‡&W7öç6R’°¢–b†—56ö6–Ä÷fW&Æ”6öÖÖæB†6ÖDæÖR’’°¢V&Æ—6…6ö6–Ä÷fW&Æ”WfVçB‡°¢6öÖÖæC¢6ÖDæÖRÀ¢FVæçD–BÀ¢7F÷#¢²æÖS¢7GVÅW6W&æÖRÒÀ¢âââ‡F&vWBò²F&vWC¢²æÖS¢F&vWBÒÒ¢·Ò’À¢&÷C¢²æÖS¢&÷DæÖRÒÀ¢æ–ÖF–öã¢°¢F†VÖS¢6ÖDæÖRÀ¢GW&F–öä×3¢6ÖDæÖRÓÓÒvÆ÷fRròó¢uóÀ¢'F–6ÆT6÷VçC¢6ÖDæÖRÓÓÒvÆ÷fRròC‚¢3"À¢&VGV6VDÖ÷F–öå6fS¢G'VRÀ¢ÒÀ¢Ò“°¢Ğ¢v—B&WÇ’‡&W7öç6RÂv&÷Br’æ6F6‚‚‚’Óâ·Ò“°¢&WGW&ã°¢Ğ¢Ğ ¢òò†æFÆR6–×ÆR&W7öç6W2gFW"æF—fR6ö6–Â6öÖÖæG26òÆVv7¢òò6ææVB&WÆ–W26ææ÷B7vÆÆ÷rF†V—"÷fW&Æ’WfVçBà¢–b‚†6öÖÖæB2ç’’ç&W7öç6Rbb†6öÖÖæB2ç’’æ7F–öä–Bbb†6öÖÖæB2ç’’æ7F–öç2’°¢v—B&WÇ’‚†6öÖÖæB2ç’’ç&W7öç6RÂv'&öF67FW"r’æ6F6‚‚‚’Óâ·Ò“°¢&WGW&ã°¢Ğ¢  ¢ ¢òòW†V7WFR7F–öâ–bÆ–æ¶V@¢–b‚†6öÖÖæB2ç’’æ7F–öä–B’°¢6öç6öÆRæÆör†´F—7F6†W%Ò6öÖÖæB†27F–öä–C¢G²†6öÖÖæB2ç’’æ7F–öä–GÖ“°¢6öç7B7F–öâÒv—BvWD7F–öä'”–B‚†6öÖÖæB2ç’’æ7F–öä–BÂFVæçD–B“°¢6öç6öÆRæÆör†´F—7F6†W%Ò7F–öâf÷VæC¦Â7F–öâòu”U2r¢täòr“°¢6öç6öÆRæÆör†´F—7F6†W%Ò7F–öâö&¦V7C¦Â¥4ôâç7G&–æv–g’†7F–öâ’“°¢–b†7F–öâbb†7F–öâ2ç’’æ†æFÆW"’°¢6öç7B†æFÆW"Ò†7F–öâ2ç’’æ†æFÆW#°¢6öç6öÆRæÆör†´F—7F6†W%ÒW†V7WF–ær†æFÆW#¢G¶†æFÆW'Ö“°¢ ¢òòW†V7WFR7W7FöÒ†æFÆW'0¢–b††æFÆW"ÓÓÒwö¶VÖöâ×6²Ö÷Vâr’°¢6öç7B4µô4õ5BÒ°¢6öç7BW6W%ö–çG2Òv—BvWEö–çD&Ææ6R†7GVÅW6W&æÖR“°¢ ¢–b‡W6W%ö–çG2Â&–t–çB…4µô4õ5B’’°¢v—B&WÇ’†G¶7GVÅW6W&æÖWÒÂ–÷RæVVBGµ4µô4õ5GÒö–çG2Fò÷Vâ6²…–÷R†fRG·W6W%ö–çG2çFõ7G&–ær‚—Ò–Âv'&öF67FW"r’æ6F6‚‚‚’Óâ·Ò“°¢&WGW&ã°¢Ğ¢ ¢v—BFEö–çG2†7GVÅW6W&æÖRÂÕ4µô4õ5B“°¢ ¢6öç7B²÷Vå6²ÒÒ&WV—&R‚râ÷ö¶VÖöâ×6·2r“°¢6öç7B&W7VÇBÒv—B÷Vå6²ƒÂ7GVÅW6W&æÖRÂVæFVf–æVBÂFVæçD–B“°¢–b‡&W7VÇB’°¢6öç7B6&D–æfòÒf÷&ÖEö¶VÖöå6´6&D–æfò‡&W7VÇBç6²“°¢ ¢6öç7B²vWEW6W$6&G2ÒÒ&WV—&R‚râ÷ö¶VÖöâÖ6öÆÆV7F–öâr“°¢6öç7BÆÄ6&G2Òv—BvWEW6W$6&G2†7GVÅW6W&æÖR“°¢6öç7B&&T6÷VçBÒÆÄ6&G2æf–ÇFW"‚†3¢ç’’Óâ2ç&&—G’bb2ç&&—G’æ–æ6ÇVFW2‚u&&Rr’’æÆVæwFƒ°¢6öç7B6´ÖW76vRÒG¶7GVÅW6W&æÖWÒ÷VæVBG·&W7VÇBç6WDæÖWÒ6²æBv÷C¢G¶6&D–æf÷ÒÂF÷FÃ¢G¶ÆÄ6&G2æÆVæwF‡Ò6&G2‚G·&&T6÷VçGÒ&&R–°¢6öç7B÷WGWD6öçFW‡BÒvWD6†D÷WGWD6öçFW‡B‚“°¢–b†÷WGWD6öçFW‡CòçÆFf÷&ÒÓÓÒvF—66÷&Br’°¢v—B6VæDF—66÷&Eö¶VÖöå6µ7VÖÖ'’†÷WGWD6öçFW‡Bæ6†ææVÄ–BÂ7GVÅW6W&æÖRÂ&W7VÇBÂÆÄ6&G2æÆVæwF‚Â&&T6÷VçBÂ6´ÖW76vR“°¢ÒVÇ6R°¢v—B&WÇ’‡6´ÖW76vRÂv'&öF67FW"r’æ6F6‚‚‚’Óâ·Ò“°¢Ğ¢Ğ¢Ğ¢ÒVÇ6R–b†7F–öâbb7F–öâç7V$7F–öç2bb7F–öâç7V$7F–öç2æÆVæwF‚â’°¢òòW†V7WFR7V$7F–öç2W6–ær7V$7F–öäW†V7WF÷ ¢6öç7B²7V$7F–öäW†V7WF÷"ÒÒv—B–×÷'B‚râöWFöÖF–öâõ7V$7F–öäW†V7WF÷"r“°¢6öç7BW†V7WF÷"ÒæWr7V$7F–öäW†V7WF÷"‚“°¢v—BW†V7WF÷"æW†V7WFT7F–öâ†7F–öâÂW†V7WF–öä6öçFW‡B“°¢Ğ¢Ğ¢ ¢–b‚†6öÖÖæB2ç’’æ7F–öç2bb†6öÖÖæB2ç’’æ7F–öç2æÆVæwF‚â’°¢6öç7B7F–öåG—RÒ†6öÖÖæB2ç’’æ7F–öç5³ÒçG—S°¢6öç6öÆRæÆör†´F—7F6†W%ÒW†V7WF–ær7F–öâG—S¢G¶7F–öåG—WÖ“°¢ ¢–b†7F–öåG—RÓÓÒv6öÖÖæG2ÖÆ—7B×6†÷rr’°¢6öç7B&W7öç6RÒt6öÖÖæG3¢6²Â6öÆÆV7F–öâÂ6†÷rÆ6&CâÂG&FRÇW6W#âÂöffW"Æ6&CâÂ66WBÂ6æ6VÂÂ6†ÆÆVævRÂGF6²Â7v—F6‚Âö–çG2ÂvÖ&ÆRÂ&öÆÂÂ6òÇW6W#âÂÆVFW"ÂF—66÷&Bs°¢v—B&WÇ’‡&W7öç6RÂv'&öF67FW"r’æ6F6‚‚‚’Óâ·Ò“°¢ÒVÇ6R–b†7F–öåG—RÓÓÒwö¶VÖöâ×6²Ö÷Vâr’°¢6öç7B4µô4õ5BÒ°¢6öç7BW6W%ö–çG2Òv—BvWEö–çD&Ææ6R†7GVÅW6W&æÖR“°¢ ¢–b‡W6W%ö–çG2Â&–t–çB…4µô4õ5B’’°¢v—B&WÇ’†G¶7GVÅW6W&æÖWÒÂ–÷RæVVBGµ4µô4õ5GÒö–çG2Fò÷Vâ6²…–÷R†fRG·W6W%ö–çG2çFõ7G&–ær‚—Ò–Âv'&öF67FW"r’æ6F6‚‚‚’Óâ·Ò“°¢&WGW&ã°¢Ğ¢ ¢v—BFEö–çG2†7GVÅW6W&æÖRÂÕ4µô4õ5B“°¢ ¢6öç7B²÷Vå6²ÒÒ&WV—&R‚râ÷ö¶VÖöâ×6·2r“°¢6öç7B&W7VÇBÒv—B÷Vå6²ƒÂ7GVÅW6W&æÖRÂVæFVf–æVBÂFVæçD–B“°¢–b‡&W7VÇB’°¢6öç7B6&D–æfòÒf÷&ÖEö¶VÖöå6´6&D–æfò‡&W7VÇBç6²“°¢ ¢6öç7B²vWEW6W$6&G2ÒÒ&WV—&R‚râ÷ö¶VÖöâÖ6öÆÆV7F–öâr“°¢6öç7BÆÄ6&G2Òv—BvWEW6W$6&G2†7GVÅW6W&æÖR“°¢6öç7B&&T6÷VçBÒÆÄ6&G2æf–ÇFW"‚†3¢ç’’Óâ2ç&&—G’bb2ç&&—G’æ–æ6ÇVFW2‚u&&Rr’’æÆVæwFƒ°¢6öç7B6´ÖW76vRÒG¶7GVÅW6W&æÖWÒ÷VæVBG·&W7VÇBç6WDæÖWÒ6²æBv÷C¢G¶6&D–æf÷ÒÂF÷FÃ¢G¶ÆÄ6&G2æÆVæwF‡Ò6&G2‚G·&&T6÷VçGÒ&&R–°¢6öç7B÷WGWD6öçFW‡BÒvWD6†D÷WGWD6öçFW‡B‚“°¢–b†÷WGWD6öçFW‡CòçÆFf÷&ÒÓÓÒvF—66÷&Br’°¢v—B6VæDF—66÷&Eö¶VÖöå6µ7VÖÖ'’†÷WGWD6öçFW‡Bæ6†ææVÄ–BÂ7GVÅW6W&æÖRÂ&W7VÇBÂÆÄ6&G2æÆVæwF‚Â&&T6÷VçBÂ6´ÖW76vR“°¢ÒVÇ6R°¢v—B&WÇ’‡6´ÖW76vRÂv'&öF67FW"r’æ6F6‚‚‚’Óâ·Ò“°¢Ğ¢Ğ¢ÒVÇ6R–b†7F–öåG—RÓÓÒwö¶VÖöâÖ6öÆÆV7F–öâ×6†÷rr’°¢6öç7B²vWEW6W$6&G2ÒÒ&WV—&R‚râ÷ö¶VÖöâÖ6öÆÆV7F–öâr“°¢6öç7B6&G2Òv—BvWEW6W$6&G2†7GVÅW6W&æÖR“°¢6öç7B&&T6÷VçBÒ6&G2æf–ÇFW"‚†3¢ç’’Óâ2ç&&—G’bb2ç&&—G’æ–æ6ÇVFW2‚u&&Rr’’æÆVæwFƒ°¢6öç7BW&ÂÒ'V–ÆEö¶VÖöä'&÷w6W%W&Â†7GVÅW6W&æÖR“°¢v—B&WÇ’€¢6&G2æÆVæwF€¢òG¶7GVÅW6W&æÖWÒ†2G¶6&G2æÆVæwF‡Ò6&G2‚G·&&T6÷VçGÒ&&R’âö¼:–FW‚ÂFV6·2æBG&FW3¢G·W&ÇÖ ¢¢G¶7GVÅW6W&æÖWÒÂ–÷W"ö¼:–FW‚—2V×G’â÷Vâ6²v—F‚6²ÂF†VâÖævR6&G2†W&S¢G·W&ÇÖÀ¢v'&öF67FW"rÀ¢’æ6F6‚‚‚’Óâ·Ò“°¢ÒVÇ6R–b†7F–öåG—RÓÓÒwö¶VÖöâ×G&FRÖ–æ—F–FRr’°¢6öç7B&w2Ò7GVÄÖW76vRç7V'7G&–ær†6ÖDæÖRæÆVæwF‚²"’çG&–Ò‚’ç7Æ—B‚õÇ2²ò“°¢6öç7BF&vWEW6W"Ò&w5³Óòç&WÆ6R‚trÂrr“°¢6öç7BW&ÂÒ'V–ÆEö¶VÖöä'&÷w6W%W&Â†7GVÅW6W&æÖRÂF&vWEW6W"ò²G&FUv—Fƒ¢F&vWEW6W"Ò¢·Ò“°¢v—B&WÇ’€¢F&vWEW6W ¢òG¶7GVÅW6W&æÖWÒÂG&FRv—F‚G·F&vWEW6W'Òg&öÒ–÷W"ö¼:–FWƒ¢G·W&ÇÖ ¢¢G¶7GVÅW6W&æÖWÒÂ÷Vâ–÷W"ö¼:–FW‚Fò6†ö÷6RG&FS¢G·W&ÇÖÀ¢v'&öF67FW"rÀ¢’æ6F6‚‚‚’Óâ·Ò“°¢Ğ¢Ğ¢&WGW&ã°¢Ğ¢ÒVÇ6R°¢òòö–çG2bvVÆ6öÖRvvöâ†öæÇ’f÷"æöâ×6VÆbÖW76vW2Fòfö–Bv&F–ær–÷W'6VÆbö–çG2¢–b‚6VÆbbb—4&÷Bbb6öç7VÖVD'•&VFV×F–öâ’°¢òò6¶—ö–çG2æBvVÆ6öÖRf÷"¶æ÷vâ&÷G0¢6öç7B6¶—4&÷BÒv—B—4¶æ÷vä&÷B†7GVÅW6W&æÖRÂFVæçD–B“°¢–b‚6¶—4&÷B’°¢6öç7B†æFÆVD6†DWFöÖF–öâÒv—B'Vä6†DWFöÖF–öåG&–vvW'2‚“°¢–b††æFÆVD6†DWFöÖF–öâ’°¢&WGW&ã°¢Ğ ¢v&D6†Eö–çG2†7GVÅW6W&æÖRÂFVæçD7G‚’æ6F6‚‚‚’Óâ·Ò“°¢ ¢òò6¶—vVÆ6öÖRvvöâf÷"'&öF67FW"Â&÷BÂæBÖW76vW2g&öÒfö–6R6öÖÖæG0¢6öç7BÆ÷vW$7GVÅW6W&æÖRÒ7GVÅW6W&æÖRçFôÆ÷vW$66R‚“°¢6öç7B6¶—vVÆ6öÖU&V6öâÒ6öç7VÖVD'•&VFV×F–öà¢òv6öç7VÖVBÖ'’×&VFV×F–öâp¢¢Fw2æ&FvW3òæ'&öF67FW ¢òv'&öF67FW"Ö&FvRp¢¢Æ÷vW$7GVÅW6W&æÖRÓÓÒ†&÷EW6W&æÖRÇÂrr’çFôÆ÷vW$66R‚¢òv&÷B×W6W&æÖRp¢¢Æ÷vW$7GVÅW6W&æÖRÓÓÒ†'&öF67FW%W6W&æÖRÇÂrr’çFôÆ÷vW$66R‚¢òv'&öF67FW"×W6W&æÖRp¢¢ÖW76vRæ–æ6ÇVFW2‚	øÉòr¢òwfö–6RÖÖW76vRp¢¢çVÆÃ°¢ ¢6öç7BvVÆ6öÖT¶W’ÒG·FVæçD–BÇÂuõövÆö&ÅõòwÓ¢G¶Æ÷vW$7GVÅW6W&æÖWÖ°¢–b‡6¶—vVÆ6öÖU&V6öâ’°¢v—B&V6÷&DWFõvVÆ6öÖU6¶—‡°¢W6W&æÖS¢7GVÅW6W&æÖRÀ¢F—7Æ”æÖRÀ¢FVæçD–BÀ¢&V6öã¢6¶—vVÆ6öÖU&V6öâÀ¢ÖWFFF¢°¢vFS¢w&R×vVÆ6öÖRrÀ¢&÷EW6W&æÖS¢&÷EW6W&æÖRÇÂçVÆÂÀ¢'&öF67FW%W6W&æÖS¢'&öF67FW%W6W&æÖRÇÂçVÆÂÀ¢—4'&öF67FW$&FvS¢&ööÆVâ‡Fw2æ&FvW3òæ'&öF67FW"’À¢ÒÀ¢Ò“°¢ÒVÇ6R–b‡VæF–æuvVÆ6öÖUW6W'2æ†2‡vVÆ6öÖT¶W’’’°¢v—B&V6÷&DWFõvVÆ6öÖU6¶—‡°¢W6W&æÖS¢7GVÅW6W&æÖRÀ¢F—7Æ”æÖRÀ¢FVæçD–BÀ¢&V6öã¢vÇ&VG’×VæF–ærrÀ¢ÖWFFF¢²vFS¢wVæF–ær×vVÆ6öÖRrÂvVÆ6öÖT¶W’ÒÀ¢Ò“°¢ÒVÇ6R°¢6öç7BvVÆ6öÖTÖöFRÒv—BvWEvVÆ6öÖTÖöFR‡FVæçD–B“° ¢–b…7G&–ær‡vVÆ6öÖTÖöFR’çFôÆ÷vW$66R‚’ÓÓÒvöfbr’°¢òòvVÆ6öÖRF—6&ÆVBW‡Æ–6—FÇ’f÷"F†—2FVæçBà¢v—B&V6÷&DWFõvVÆ6öÖU6¶—‡°¢W6W&æÖS¢7GVÅW6W&æÖRÀ¢F—7Æ”æÖRÀ¢FVæçD–BÀ¢&V6öã¢wvVÆ6öÖRÖÖöFRÖöfbrÀ¢ÖWFFF¢²vFS¢wvVÆ6öÖRÖÖöFRrÂvVÆ6öÖTÖöFRÒÀ¢Ò“°¢ÒVÇ6R°¢6öç7BvVÆ6öÖTVÆ–v–&–Æ—G’Òv—BvWEvVÆ6öÖTVÆ–v–&–Æ—G’†7GVÅW6W&æÖRÂFVæçD–B“°¢–b‚vVÆ6öÖTVÆ–v–&–Æ—G’æVÆ–v–&ÆR’°¢v—B&V6÷&DWFõvVÆ6öÖU6¶—‡°¢W6W&æÖS¢7GVÅW6W&æÖRÀ¢F—7Æ”æÖRÀ¢FVæçD–BÀ¢&V6öã¢vVÆ6öÖTVÆ–v–&–Æ—G’ç&V6öâÀ¢ÖWFFF¢²vFS¢vf—'7BÖÖW76vR×W"ÖF’rÂvVÆ6öÖT¶W’ÒÀ¢Ò“°¢ÒVÇ6R°¢òòf—'7B‡VÖâÖW76vRf÷"F†—2W6W"FöF’âÖ&²–ÖÖVF–FVÇ’6ò¢òò6Æ÷r6Æ—õEE2F‚6ææ÷B&WG&–vvW"öâWfW'’ÆFW"6†BÆ–æRà¢6öç7B&öf–ÆT–ÖvRÒ‡GG3¢ò÷7FF–2Ö6Fâæ§GfçrææWBö§Ge÷W6W%÷–7GW&W2òG¶7GVÅW6W&æÖWÒ×&öf–ÆUö–ÖvRÓ3ƒ3çæv°¢VæF–æuvVÆ6öÖUW6W'2æFB‡vVÆ6öÖT¶W’“°¢v—BÖ&µW6W%vVÆ6öÖVB†7GVÅW6W&æÖRÂFVæçD–B“°¢v—B&V6÷&E6†÷WF÷WDVF—B‡°¢7FGW3¢wG&–vvW&VBrÀ¢W6W&æÖS¢7GVÅW6W&æÖRÀ¢F—7Æ”æÖRÀ¢FVæçD–BÀ¢6÷W&6S¢vWFò×vVÆ6öÖRrÀ¢ÖWFFF¢²vVÆ6öÖTÖöFRÂ6ööÆF÷vä'—76VC¢fÇ6RÒÀ¢Ò“°¢†æFÆUvÆ´öå6†÷WF÷WB†7GVÅW6W&æÖRÂF—7Æ”æÖRÂ&öf–ÆT–ÖvRÂfÇ6RÂFVæçD–BÂ²6÷W&6S¢vWFò×vVÆ6öÖRrÒ¢çF†Vâ‚†6ö×ÆWFVB’Óâ°¢–b†6ö×ÆWFVB’&WGW&ã°¢&WGW&â&V6÷&E6†÷WF÷WDVF—B‡°¢7FGW3¢w6¶—VBrÀ¢W6W&æÖS¢7GVÅW6W&æÖRÀ¢F—7Æ”æÖRÀ¢FVæçD–BÀ¢6÷W&6S¢vWFò×vVÆ6öÖRrÀ¢&V6öã¢v†æFÆW"×&WGW&æVBÖfÇ6RrÀ¢ÖWFFF¢²vFS¢wvÆ²ÖöâÖ†æFÆW"rÂvVÆ6öÖTÖöFRÂ6ööÆF÷vä'—76VC¢fÇ6RÒÀ¢Ò“°¢Ò¢æ6F6‚†W'"Óâ°¢6öç6öÆRæW'&÷"‚u´F—7F6†W%ÒvÆ²Ööâ6†÷WF÷WBf–ÆVC¢rÂW'"“°¢&V6÷&E6†÷WF÷WDVF—B‡°¢7FGW3¢vf–ÆVBrÀ¢W6W&æÖS¢7GVÅW6W&æÖRÀ¢F—7Æ”æÖRÀ¢FVæçD–BÀ¢6÷W&6S¢vWFò×vVÆ6öÖRrÀ¢W'&÷#¢VF—DW'&÷"†W'"’À¢Ò’æ6F6‚‚‚’Óâ·Ò“°¢6öç7B²VWVUvÆ´öå&WG'’ÒÒ&WV—&R‚râ÷vÆ²Ööâ×&V6÷fW'’r“°¢&WGW&âVWVUvÆ´öå&WG'’‡°¢FVæçD–BÀ¢W6W&æÖS¢7GVÅW6W&æÖRÀ¢F—7Æ”æÖRÀ¢&öf–ÆT–ÖvRÀ¢W'&÷#¢W'"À¢Ò’æ6F6‚‚‡VWVTW'#¢ç’’Óâ°¢6öç6öÆRæW'&÷"‚u´F—7F6†W%Òf–ÆVBFòVWVRvÆ²Ööâ&V6÷fW'“¢rÂVWVTW'"“°¢Ò“°¢Ò¢æf–æÆÇ’‚‚’Óâ°¢VæF–æuvVÆ6öÖUW6W'2æFVÆWFR‡vVÆ6öÖT¶W’“°¢Ò“°¢Ğ¢Ğ¢Ğ¢ÒVÇ6R°¢v—B&V6÷&DWFõvVÆ6öÖU6¶—‡°¢W6W&æÖS¢7GVÅW6W&æÖRÀ¢F—7Æ”æÖRÀ¢FVæçD–BÀ¢&V6öã¢v¶æ÷vâÖ&÷BrÀ¢ÖWFFF¢²vFS¢v¶æ÷vâÖ&÷BrÒÀ¢Ò“°¢Ğ¢Ğ¢ ¢6öç7BW6W$—4¶æ÷vä&÷BÒv—B—4¶æ÷vä&÷B†7GVÅW6W&æÖRÂFVæçD–B“°¢6öç7B²vWD&÷E6†&TÖöFS¢6†V6´&÷E6†&TÖöFRÒÒ&WV—&R‚rââöÆ–"ö&÷BÖ–çFW&7F–öç2×7F÷&Rr“°¢6öç7B&÷E6†&TVæ&ÆVBÒW6W$—4¶æ÷vä&÷Bbb†v—B6†V6´&÷E6†&TÖöFR‡FVæçD–B’’ÓÓÒvöâs°¢–b‚—4&÷Bbb6VÆbbb‚W6W$—4¶æ÷vä&÷BÇÂ&÷E6†&TVæ&ÆVB’’°¢6öç7BÆ÷vW$ÖW76vRÒ7GVÄÖW76vRçFôÆ÷vW$66R‚“°¢6öç6öÆRæÆör†´F—7F6†W%ÒæöâÖ6öÖÖæBÖW76vRg&öÒG¶7GVÅW6W&æÖWÒÂ6†V6¶–ærÖVçF–öç2âÆ÷vW$ÖW76vS¢"G¶Æ÷vW$ÖW76vRç6Æ–6RƒÂƒ—Ò&“° ¢òòwV&G&–Ã¢–â6†ææVÇ2F†B&RäõBF†R'&öF67FW"w2÷vâ6†ææVÂÀ¢òòF†Væ6†÷VÆBöæÇ’&W7öæBv†VâF†R'&öF67FW"F†V×6VÆb—27V¶–ærà¢òò6¶—F†RwV&G&–ÂVçF—&VÇ’–b'&öF67FW%W6W&æÖRv2æWfW"&W6öÇfV@¢òò‡7F–ÆÂF†RFVfVÇBv'&öF67FW"r“²÷F†W'v—6RvRv÷VÆB6–ÆVçFÇ’7W&W70¢òòÄÂ&÷BÖVçF–öâ&W7öç6W2Âv†–6‚—2fW'’†&BFòFV'Vrà¢6öç7B&W6öÇfVD'&öF67FW"Ò†'&öF67FW%W6W&æÖRÇÂrr’çFôÆ÷vW$66R‚“°¢6öç7B†5&W6öÇfVD'&öF67FW"Ò&W6öÇfVD'&öF67FW"bb&W6öÇfVD'&öF67FW"ÓÒv'&öF67FW"s°¢–b††5&W6öÇfVD'&öF67FW"’°¢6öç7B—4÷vä6†ææVÂÒ&WÇ”6†ææVÂçFôÆ÷vW$66R‚’ÓÓÒ&W6öÇfVD'&öF67FW#°¢6öç7B—4'&öF67FW%7V¶W"Ò7GVÅW6W&æÖRçFôÆ÷vW$66R‚’ÓÓÒ&W6öÇfVD'&öF67FW#°¢–b‚—4÷vä6†ææVÂbb—4'&öF67FW%7V¶W"bb&÷E6†&TVæ&ÆVB’°¢&WGW&ã°¢Ğ¢ÒVÇ6R°¢6öç6öÆRçv&â‚u´F—7F6†W%Ò'&öF67FW%W6W&æÖRVç&W6öÇfVB†6öæf–r÷Fö¶Vç2Vç&VF&ÆR“²6¶—–ærf÷&V–vâÖ6†ææVÂwV&G&–Âf÷"rÂ²FVæçD–BÂ&WÇ”6†ææVÂÒ“°¢Ğ¢ ¢òò76TÖ÷VçF–äÆ—fR—2W&ÖæVçB7—7FVÒFVæçBâVçF–Â7FVÆÆ†0¢òò†W"÷vâGv—F6‚ôWF‚Â7G&VÕvVfW#ƒröæÇ’G&ç7÷'G2öÆ—7FVç2Fò6†C°¢òòF—&V7B7FVÆÆ–çfö6F–öç2&öGV6R’²EE2öfF"÷WGWBv—F†÷W@¢òò÷7F–ær7FVÆÆw2FW‡B&6²–çFòGv—F6‚à¢–b€¢FVæçD–BÓÓÒ54TÔõTåD”åõ5•5DTÕõDTäåEô”@¢bb—46öÖÖæ@¢bbW6W$—4¶æ÷vä&÷@¢bbò…çÅÅr—7FVÆÆ…ÅwÂB’ö’çFW7B†7GVÄÖW76vR¢’°¢G'’°¢6öç7B&W7öç6RÒv—BfWF6‚†‡GG¢òó#rããã¢G·&ö6W72æVçbåõ%BÇÂ3Òö’ö’ö6†B×v—F‚ÖÖVÖ÷'–Â°¢ÖWF†öC¢uõ5BrÀ¢†VFW'3¢–çFW&æÅ6W'f–6T†VFW'2‡²t6öçFVçBÕG—Rs¢vÆ–6F–öâö§6öârÒ’À¢&öG“¢¥4ôâç7G&–æv–g’‡°¢W6W&æÖS¢7GVÅW6W&æÖRÀ¢F—7Æ”æÖRÀ¢W6W$–C¢7G&–ær‡Fw3òå²wW6W"Ö–BuÒÇÂrr’çG&–Ò‚’ÇÂVæFVf–æVBÀ¢ÖW76vS¢7GVÄÖW76vRÀ¢FVæçD–C¢54TÔõTåD”åõ5•5DTÕõDTäåEô”BÀ¢6†ææVÄ–C¢&WÇ”6†ææVÂÀ¢6öçFW‡C¢wGv—F6‚rÀ¢Ò’À¢Ò“° ¢–b‚&W7öç6Ræö²’°¢6öç6öÆRæW'&÷"‚u´F—7F6†W%Ò7FVÆÆ7—7FVÒ×FVæçB’f–ÆVC¢rÂ&W7öç6Rç7FGW2Âv—B&W7öç6RçFW‡B‚’æ6F6‚‚‚’Óârr’“°¢&WGW&ã°¢Ğ ¢6öç7BFFÒv—B&W7öç6Ræ§6öâ‚“°¢6öç7B•&WÇ’Ò7G&–ær†FFç&W7öç6RÇÂFFæFFòç&W7öç6RÇÂrr’çG&–Ò‚“°¢–b‚•&WÇ’’&WGW&ã° ¢6öç7BGG2Òv—BVWVUGG4÷fW&Æ’†•&WÇ’Â54TÔõTåD”åõ5•5DTÕõDTäåEô”B“°¢–b‚GG2æö²’°¢6öç6öÆRçv&â‚u´F—7F6†W%Ò7FVÆÆ7—7FVÒ×FVæçBEE2VWVRf–ÆVC¢rÂGG2æW'&÷"“°¢Ğ ¢–b‡FVæçD†4&÷D66÷VçB…54TÔõTåD”åõ5•5DTÕõDTäåEô”B’’°¢v—B6VæD6†DÖW76vR€¢•&WÇ’À¢v&÷BrÀ¢&WÇ”6†ææVÂÀ¢54TÔõTåD”åõ5•5DTÕõDTäåEô”BÀ¢’æ6F6‚‚†W'&÷"’Óâ°¢6öç6öÆRçv&â‚u´F—7F6†W%Ò7FVÆÆGv—F6‚6†BFVÆ—fW'’f–ÆVC¢rÂW'&÷"“°¢Ò“°¢6öç6öÆRæÆör†´F—7F6†W%Ò7FVÆÆç7vW&VBG¶7GVÅW6W&æÖWÒf–Gv—F6‚²Æ÷VævREE2–â2G·&WÇ”6†ææVÇÖ“°¢ÒVÇ6R–b‡GG2æö²’°¢6öç6öÆRæÆör†´F—7F6†W%Ò7FVÆÆç7vW&VBG¶7GVÅW6W&æÖWÒf–Æ÷VævREE2–â2G·&WÇ”6†ææVÇÖ“°¢Ğ¢Ò6F6‚†W'&÷"’°¢6öç6öÆRæW'&÷"‚u´F—7F6†W%Ò7FVÆÆ7—7FVÒ×FVæçB&W7öç6Rf–ÆVC¢rÂW'&÷"“°¢Ğ¢&WGW&ã°¢Ğ ¢òòF†R6÷VçB—2'V–ÇBÖ–â6†&7FW"Âæ÷BFVæçB&÷Bâ†—2Gv—F6€¢òò66÷VçB—2öæÇ’FVÆ—fW'’–FVçF—G“²F†R6æöæ–6Â&Æ6²†öÆP¢òòVçF—FÆVÖVçB&VÖ–ç2F†R6öÆRW'6öæÂ–çfö6F–öâvFRà¢–b‚—46öÖÖæBbbW6W$—4¶æ÷vä&÷BbbÖW76vT–çfö¶W5F†T6÷VçB†7GVÄÖW76vR’’°¢6öç7BGv—F6…W6W$–BÒ7G&–ær‡Fw3òå²wW6W"Ö–BuÒÇÂrr’çG&–Ò‚“°¢6öç7BVçF—FÆVÖVçBÒv—BvWE7×DV7FW$VvtVçF—FÆVÖVçB‡°¢&÷f–FW#¢wGv—F6‚rÀ¢&÷f–FW%W6W$–C¢Gv—F6…W6W$–BÀ¢Ò“°¢–b‚VçF—FÆVÖVçBæVvw2æ&Æ6´†öÆR’°¢&WGW&ã°¢Ğ ¢G'’°¢6öç7B&W7öç6RÒv—BfWF6‚†‡GG¢òó#rããã¢G·&ö6W72æVçbåõ%BÇÂ3Òö’ö’ö6†B×v—F‚ÖÖVÖ÷'–Â°¢ÖWF†öC¢uõ5BrÀ¢†VFW'3¢–çFW&æÅ6W'f–6T†VFW'2‡²t6öçFVçBÕG—Rs¢vÆ–6F–öâö§6öârÒ’À¢&öG“¢¥4ôâç7G&–æv–g’‡°¢W6W&æÖS¢7GVÅW6W&æÖRÀ¢F—7Æ”æÖRÀ¢W6W$–C¢Gv—F6…W6W$–BÀ¢ÖW76vS¢7GVÄÖW76vRÀ¢W'6öæÆ—G“¢D„Uô4õTåEõU%4ôäÄ•E’À¢&W7öç6TæÖS¢D„Uô4õTåEôäÔRÀ¢FVæçD–C¢FVæçD–BÇÂVæFVf–æVBÀ¢6†ææVÄ–C¢&WÇ”6†ææVÂÀ¢6öçFW‡C¢wGv—F6‚Ö7&÷72Ö&÷BrÀ¢Ò’À¢Ò“° ¢–b‚&W7öç6Ræö²’°¢6öç6öÆRæW'&÷"‚u´F—7F6†W%ÒF†R6÷VçBGv—F6‚’f–ÆVC¢rÂ&W7öç6Rç7FGW2“°¢&WGW&ã°¢Ğ ¢6öç7BFFÒv—B&W7öç6Ræ§6öâ‚“°¢6öç7B•&WÇ’Ò7G&–ær†FFç&W7öç6RÇÂFFæFFòç&W7öç6RÇÂrr’çG&–Ò‚“°¢–b‚•&WÇ’’&WGW&ã° ¢6öç7B&W7öç6T6†ææVÂÒv—B&W6öÇfUGv—F6…&WÇ”6†ææVÂ‡°¢6÷W&6T6†ææVÃ¢&WÇ”6†ææVÂÀ¢6÷W&6UFVæçD–C¢FVæçD–BÀ¢&W7öç6UFVæçD–C¢FVæçD–BÀ¢Ò“°¢v—B6VæD6†DÖW76vR†•&WÇ’Âv6÷VçBrÂ&W7öç6T6†ææVÂÂFVæçD–B“°¢6öç6öÆRæÆör†´F—7F6†W%ÒF†R6÷VçBç7vW&VBG¶7GVÅW6W&æÖWÒ–â2G·&W7öç6T6†ææVÇÖ“°¢Ò6F6‚†W'&÷"’°¢6öç6öÆRæW'&÷"‚u´F—7F6†W%ÒF†R6÷VçBGv—F6‚&W7öç6Rf–ÆVC¢rÂW'&÷"“°¢Ğ¢&WGW&ã°¢Ğ ¢òò6†V6²f÷"6†÷WF÷WB6öÖÖæB‡v—F†÷WB&÷BæÖR¢òò6¶—ÖW76vW2F†BÆöö²Æ–¶RF†Rf÷&ÖGFVB6†÷WF÷WB÷WGWBFò&WfVçB&R×G&–vvW&–æp¢òò6¶—6†÷WF÷WB&ö6W76–ærf÷"¶æ÷vâ&÷G2Fò&WfVçBWFöÖFVBÖW76vW2g&öÒG&–vvW&–ær6†÷WF÷WG0¢6öç7B—56†÷WF÷WD÷WGWBÒÆ÷vW$ÖW76vRæ–æ6ÇVFW2‚vvò6†V6²÷WBr’bbÆ÷vW$ÖW76vRæ–æ6ÇVFW2‚wGv—F6‚çGbòr“°¢6öç7B&WVW7FVE6†÷WF÷WEF&vWBÒW‡G&7E6†÷WF÷WE&WVW7EF&vWB†7GVÄÖW76vR“°¢–b‚&÷E6†&TVæ&ÆVBbb—56†÷WF÷WD÷WGWBbb&WVW7FVE6†÷WF÷WEF&vWB’°¢6öç6öÆRæÆör‚u´F—7F6†W%Ò6†÷WF÷WB6öÖÖæBFWFV7FVBr“°¢G'’°¢6öç7BFVæçEVW'’ÒFVæçD–Bò÷FVæçCÒG¶Væ6öFUU$”6ö×öæVçB‡FVæçD–B—Ö¢rs°¢6öç7B6†GFW'5&W7öç6RÒv—BfWF6‚†‡GG¢òó#rããã¢G·&ö6W72æVçbåõ%GÇÃ3Òö’ö6†Bö6†GFW'2G·FVæçEVW'—ÖÂ°¢†VFW'3¢–çFW&æÅ6W'f–6T†VFW'2‚’À¢Ò“°¢ÆWB6†GFW'2ÒµÓ°¢–b†6†GFW'5&W7öç6Ræö²’°¢6öç7B6†GFW'4FFÒv—B6†GFW'5&W7öç6Ræ§6öâ‚“°¢6†GFW'2Ò6†GFW'4FFæ6†GFW'3òæÖ‚†3¢ç’’Óâ2çW6W%öÆöv–âÇÂ2çW6W%öF—7Æ•öæÖR’æf–ÇFW"„&ööÆVâ’ÇÂµÓ°¢6öç6öÆRæÆör‚u´F—7F6†W%ÒfWF6†VB6†GFW'3¢rÂ6†GFW'2æ¦ö–â‚rÂr’“°¢Ğ ¢6öç7BÖF6†VEW6W&æÖRÒv—BÖF6…6†÷WF÷WEF&vWB‡&WVW7FVE6†÷WF÷WEF&vWBÂ6†GFW'2“°¢–b†ÖF6†VEW6W&æÖR’°¢6öç6öÆRæÆör†´F—7F6†W%ÒÖF6†VB6†÷WF÷WBF&vWC¢G¶ÖF6†VEW6W&æÖWÖ“°¢6öç7B&öf–ÆT–ÖvRÒ‡GG3¢ò÷7FF–2Ö6Fâæ§GfçrææWBö§Ge÷W6W%÷–7GW&W2òG¶ÖF6†VEW6W&æÖWÒ×&öf–ÆUö–ÖvRÓ3ƒ3çæv°¢v—B†æFÆUvÆ´öå6†÷WF÷WB†ÖF6†VEW6W&æÖRÂÖF6†VEW6W&æÖRÂ&öf–ÆT–ÖvRÂG'VRÂFVæçD–B’æ6F6‚‚‚’Óâ·Ò“°¢ÒVÇ6R°¢6öç6öÆRæÆör‚u´F—7F6†W%Òæò6†÷WF÷WBF&vWBÖF6‚f÷VæBr“°¢v—B&WÇ”Ö–&T¶–6²‚t6÷VÆBæ÷Bf–æBÖF6†–ærW6W"–â6†BrÂv&÷Br’æ6F6‚‚‚’Óâ·Ò“°¢Ğ¢Ò6F6‚†W'&÷"’°¢6öç6öÆRæW'&÷"‚u´F—7F6†W%Ò6†÷WF÷WBÖF6†–ærf–ÆVC¢rÂW'&÷"“°¢Ğ¢&WGW&ã°¢Ğ¢ ¢6öç7B²vWD&÷DæÖRÂvWD&÷D–çFW&W7G2ÂvWD&÷DÆ–6W2ÒÒ&WV—&R‚rââöÆ–"ö&÷B×6WGF–æw2×7F÷&Rr“°¢6öç7BÆö6Ä6öæf–wW&VD&÷DæÖRÒvWD&÷DæÖR‡FVæçD–B“°¢ÆWB&÷DæÖRÒÆö6Ä6öæf–wW&VD&÷DæÖS°¢ÆWB&W7öç6UFVæçD–BÒFVæçD–C°¢ÆWB&W7öç6T&÷DæÖRÒ&÷DæÖS°¢ÆWBF†VæFVæ–VBÒfÇ6S°¢6öç7BW‡Æ–6—EGv—F6„&÷DÖVçF–öç2Òv—BvWDW‡Æ–6—EGv—F6„&÷DÖVçF–öç2†7GVÄÖW76vR“°¢6öç7Bf—'7DÆ÷&T&÷BÒv—BvWDf—'7DÖVçF–öæVDÆ÷&T&÷B†7GVÄÖW76vR“°¢6öç7BÆö6ÄÆ÷&T&÷BÒv—BvWDÆ÷&T6†&7FW$f÷%FVæçB‡FVæçD–B“°¢6öç7BÆö6Å&VÆ•F&vWBÒÆö6ÄÆ÷&T&÷BÇÂ‡FVæçD–@¢ò'V–ÆDfÆÆ&6´Æ÷&T6†&7FW"‡°¢FVæçD–BÀ¢æÖS¢Æö6Ä6öæf–wW&VD&÷DæÖRÀ¢Æ–6W3¢7G&–ær†vWD&÷DÆ–6W2‡FVæçD–B’ÇÂrr’ç7Æ—B‚rÂr’æÖ‚‡fÇVR’ÓâfÇVRçG&–Ò‚’’æf–ÇFW"„&ööÆVâ’À¢Ò¢¢VæFVf–æVB“°¢6öç7Bf—'7DW‡Æ–6—EGv—F6„&÷BÒW‡Æ–6—EGv—F6„&÷DÖVçF–öç5³Ó°¢6öç7Bf—'7DÆ÷&UFVæçD–BÒf—'7DÆ÷&T&÷Bòv—B&W6öÇfUFVæçDf÷$Æ÷&T&÷B†f—'7DÆ÷&T&÷BÂVæFVf–æVB’¢VæFVf–æVC°¢6öç7Bf—'7DÆ÷&T–æFW‚ÒvWDÆ÷&T6†&7FW$f—'7D–æFW‚†7GVÄÖW76vRÂf—'7DÆ÷&T&÷B“°¢6öç7B—4‡VÖå7V¶W"ÒW6W$—4¶æ÷vä&÷C°¢6öç7B6åW6TF†VæÆ–4ç—v†W&RÒ—4‡VÖå7V¶W ¢bb6åW6TF†VæÆ–4÷fW'&–FR†7GVÅW6W&æÖR¢bbf—'7DÆ÷&T&÷Còç7F&ÆT–BÓÓÒD„Täõ5D$ÄUô”C°¢6öç7B6†÷VÆE&VfW$W‡Æ–6—EGv—F6„&÷BÒf—'7DW‡Æ–6—EGv—F6„&÷@¢bb†f—'7DÆ÷&T–æFW‚ÂÇÂf—'7DW‡Æ–6—EGv—F6„&÷Bæ–æFW‚ÃÒf—'7DÆ÷&T–æFW‚“°¢6öç7B&÷WFVDW‡FW&æÄ&÷BÒ—4‡VÖå7V¶W"bb‡6†÷VÆE&VfW$W‡Æ–6—EGv—F6„&÷BÇÂ6åW6TF†VæÆ–4ç—v†W&R¢ò‡6†÷VÆE&VfW$W‡Æ–6—EGv—F6„&÷Bòf—'7DW‡Æ–6—EGv—F6„&÷Còæ6†&7FW"¢f—'7DÆ÷&T&÷B¢¢VæFVf–æVC°¢6öç7B&÷WFVDW‡FW&æÅFVæçD–BÒ—4‡VÖå7V¶W"bb‡6†÷VÆE&VfW$W‡Æ–6—EGv—F6„&÷BÇÂ6åW6TF†VæÆ–4ç—v†W&R¢ò‡6†÷VÆE&VfW$W‡Æ–6—EGv—F6„&÷Bòf—'7DW‡Æ–6—EGv—F6„&÷CòçFVæçD–B¢f—'7DÆ÷&UFVæçD–B¢¢VæFVf–æVC° ¢–b‡&÷WFVDW‡FW&æÄ&÷Bbb&÷WFVDW‡FW&æÅFVæçD–Bbb&÷WFVDW‡FW&æÅFVæçD–BÓÒFVæçD–B’°¢6öç7B—4F†VæWfW'—v†W&RÒ&÷WFVDW‡FW&æÄ&÷Bç7F&ÆT–BÓÓÒD„Täõ5D$ÄUô”C°¢6öç7B6åW6TF†VæÒ—4F†VæWfW'—v†W&RÇÂ€¢v—BvWDF†VæWfW'—v†W&TÖöFR‚’ÓÓÒvöâp¢bbv—B6å&÷WFTF†Væf÷%W6W"‡°¢W6W&æÖS¢7GVÅW6W&æÖRÀ¢FVæçD–C¢D„Täõt„•DTÄ•5EõDTäåEô”BÀ¢Ò¢“°¢–b†6åW6TF†Væ’°¢&W7öç6UFVæçD–BÒ&÷WFVDW‡FW&æÅFVæçD–C°¢&W7öç6T&÷DæÖRÒ&÷WFVDW‡FW&æÄ&÷Bæ7W'&VçDæÖS°¢&÷DæÖRÒ&÷WFVDW‡FW&æÄ&÷Bæ7W'&VçDæÖS°¢6öç6öÆRæÆör†´F—7F6†W%Ò7&÷72Ö&÷Bf—'7BÖVçF–öâ&÷WF–ær"G¶7GVÄÖW76vWÒ"g&öÒ2G·&WÇ”6†ææVÇÒFòG·&÷WFVDW‡FW&æÄ&÷Bæ7W'&VçDæÖWÒFVæçBG·&÷WFVDW‡FW&æÅFVæçD–GÖ“°¢ÒVÇ6R–b†—4F†VæWfW'—v†W&R’°¢F†VæFVæ–VBÒG'VS°¢6öç6öÆRæÆör†´F—7F6†W%ÒF†VæÖVçF–öâ–væ÷&VBf÷"æöâ×v†—FVÆ—7FVBW6W"G¶7GVÅW6W&æÖWÒ–â2G·&WÇ”6†ææVÇÖ“°¢Ğ¢Ğ¢6öç7BÖVçF–öåG&–vvW'2Ò°¢G¶&÷EW6W&æÖRçFôÆ÷vW$66R‚—ÖÀ¢&÷EW6W&æÖRçFôÆ÷vW$66R‚’À¢&÷DæÖRçFôÆ÷vW$66R‚’À¢†W’G¶&÷DæÖRçFôÆ÷vW$66R‚—Ö ¢Òæf–ÇFW"„&ööÆVâ“°¢òòFBWBæÖW2òÆ–6W2†Rærâ&ææ–R"f÷"F†Væ¢6öç7BWDæÖW2Ò†vWD&÷DÆ–6W2‡&W7öç6UFVæçD–B’ÇÂrr’çFôÆ÷vW$66R‚’ç7Æ—B‚rÂr’æÖ‚‡3¢7G&–ær’Óâ2çG&–Ò‚’’æf–ÇFW"„&ööÆVâ“°¢6öç6öÆRæÆör†´F—7F6†W%ÒÆöFVBÆ–6W2f÷"FVæçBG·&W7öç6UFVæçD–GÓ¢²G·WDæÖW2æ¦ö–â‚rÂr—ÕÖ“°¢f÷"†6öç7BÆ–2öbWDæÖW2’°¢ÖVçF–öåG&–vvW'2çW6‚†Æ–2“°¢ÖVçF–öåG&–vvW'2çW6‚††W’G¶Æ–7Ö“°¢Ğ¢6öç6öÆRæÆör†´F—7F6†W%ÒÖVçF–öåG&–vvW'2f÷"FVæçBG·FVæçD–GÓ¦ÂÖVçF–öåG&–vvW'2æ¦ö–â‚rÂr’“° ¢G'’°¢6öç7B²FV6–FT&÷D–çFW&7F–öâÂVæD&÷D–çFW&7F–öâÒÒv—B–×÷'B‚rââöÆ–"ö&÷BÖ–çFW&7F–öç2×7F÷&Rr“°¢6öç7B6åW6TF†Væ–åF†—46†BÒv—BvWDF†VæWfW'—v†W&TÖöFR‚’ÓÓÒvöâp¢bbv—B6å&÷WFTF†Væf÷%W6W"‡°¢W6W&æÖS¢7GVÅW6W&æÖRÀ¢FVæçD–C¢D„Täõt„•DTÄ•5EõDTäåEô”BÀ¢Ò“°¢6öç7BÆÆ÷vVEGv—F6…'F–6—çG2ÒæWr6WCÇ7G&–æsâ†W‡Æ–6—EGv—F6„&÷DÖVçF–öç2æÖ‚†VçG'’’ÓâVçG'’æ6†&7FW"ç7F&ÆT–B’“°¢–b†Æö6ÄÆ÷&T&÷Còç7F&ÆT–B’ÆÆ÷vVEGv—F6…'F–6—çG2æFB†Æö6ÄÆ÷&T&÷Bç7F&ÆT–B“°¢–b†6åW6TF†Væ–åF†—46†B’ÆÆ÷vVEGv—F6…'F–6—çG2æFB„D„Täõ5D$ÄUô”B“°¢6öç7BFG&W76VEFõ&W7öç6T&÷BÒÖVçF–öåG&–vvW'2ç6öÖR‡G&–vvW"ÓâÆ÷vW$ÖW76vRæ–æ6ÇVFW2‡G&–vvW"’“°¢6öç7BÆVF–ætÆ÷&T&÷BÒf—'7DÆ÷&T&÷Bbbf—'7DÆ÷&T–æFW‚ãÒbbf—'7DÆ÷&T–æFW‚ÃÒ€¢7GVÄÖW76vRçG&–Ò‚’çFôÆ÷vW$66R‚’ç7F'G5v—F‚‚v†W’r’òB¢¢’òf—'7DÆ÷&T&÷B¢VæFVf–æVC° ¢–b‡&W7öç6UFVæçD–Bbb†FG&W76VEFõ&W7öç6T&÷BÇÂÆVF–ætÆ÷&T&÷B’’°¢6öç7B÷W&FW4÷våFVæçBÒ&W7öç6UFVæçD–BÓÓÒFVæçD–C°¢6öç7B'&öF67FW%7V¶–ærÒ&ööÆVâ‡Fw2æ&FvW3òæ'&öF67FW"¢ÇÂ††5&W6öÇfVD'&öF67FW"bb7GVÅW6W&æÖRçFôÆ÷vW$66R‚’ÓÓÒ&W6öÇfVD'&öF67FW"“°¢6öç7B7F–öå&öÆS¢&÷D7F÷%&öÆRÒ÷W&FW4÷våFVæçBbb'&öF67FW%7V¶–æp¢òv÷væW"p¢¢÷W&FW4÷våFVæçBbbFw2æÖö@¢òvÖöFW&F÷"p¢¢vÖVÖ&W"s°¢6öç7B&÷D7F–öâÒv—B&÷WFT&÷D7F–öâ†7GVÄÖW76vRÂ°¢FVæçD–C¢&W7öç6UFVæçD–BÀ¢&÷DæÖS¢&W7öç6T&÷DæÖRÀ¢6÷W&6S¢wGv—F6‚rÀ¢f—6–&–Æ—G“¢wV&Æ–2rÀ¢ÖW76vS¢7GVÄÖW76vRÀ¢&WVW7D–C¢Fw2æ–BòGv—F6ƒ¢G·Fw2æ–GÖ¢VæFVf–æVBÀ¢7F÷#¢°¢W6W$–C¢7G&–ær‡Fw3òå²wW6W"Ö–BuÒÇÂrr’çG&–Ò‚’ÇÂVæFVf–æVBÀ¢W6W&æÖS¢7GVÅW6W&æÖRÀ¢F—7Æ”æÖRÀ¢&öÆS¢7F–öå&öÆRÀ¢ÒÀ¢Ò“°¢–b†&÷D7F–öâ’°¢6öç7B&W7öç6T6†ææVÂÒv—B&W6öÇfUGv—F6…&WÇ”6†ææVÂ‡°¢6÷W&6T6†ææVÃ¢&WÇ”6†ææVÂÀ¢6÷W&6UFVæçD–C¢FVæçD–BÀ¢&W7öç6UFVæçD–BÀ¢Ò“°¢v—B6VæD6†DÖW76vR†&÷D7F–öâç&W7öç6RÂv&÷BrÂ&W7öç6T6†ææVÂÂ&W7öç6UFVæçD–B’æ6F6‚‚‚’Óâ·Ò“°¢6öç6öÆRæÆör†´F—7F6†W%Ò&÷B7F–öâG¶&÷D7F–öâæ7F–öçÒG¶&÷D7F–öâç7FGW7Òf÷"FVæçBG·&W7öç6UFVæçD–GÒg&öÒGv—F6†“°¢&WGW&ã°¢Ğ¢Ğ ¢6öç7B&VÆ”6öÖÖæD&÷BÒÆVF–ætÆ÷&T&÷@¢ÇÂ&÷WFVDW‡FW&æÄ&÷@¢ÇÂv—BvWDÆ÷&T6†&7FW$f÷%FVæçB‡&W7öç6UFVæçD–B¢ÇÂÆö6ÄÆ÷&T&÷@¢ÇÂ'V–ÆDfÆÆ&6´Æ÷&T6†&7FW"‡°¢FVæçD–C¢&W7öç6UFVæçD–BÀ¢æÖS¢&W7öç6T&÷DæÖRÀ¢Æ–6W3¢¶&÷EW6W&æÖRÂââçWDæÖW5ÒÀ¢Ò“°¢6öç7B&VÆ”6öÖÖæEFVæçD–BÒv—B&W6öÇfUFVæçDf÷$Æ÷&T&÷B€¢&VÆ”6öÖÖæD&÷BÀ¢&W7öç6UFVæçD–BÀ¢’ÇÂ&W7öç6UFVæçD–C°¢6öç7B&VÆ”&÷DæÖW2Ò°¢&VÆ”6öÖÖæD&÷Bæ7W'&VçDæÖRÀ¢âââ‡&VÆ”6öÖÖæD&÷BæÆ–6W2ÇÂµÒ’À¢âââ‡&VÆ”6öÖÖæD&÷Bç&Wf–÷W4æÖW2ÇÂµÒ’À¢&W7öç6T&÷DæÖRÀ¢&÷EW6W&æÖRÀ¢ââçWDæÖW2À¢Ó° ¢–b†—4‡VÖå7V¶W"’°¢6öç7B&VÆ•&WÇ’Òv—B†æFÆT&÷E&VÆ•&WÇ’‡°¢6÷W&6UÆFf÷&Ó¢wGv—F6‚rÀ¢6÷W&6T6†ææVÄ–C¢&WÇ”6†ææVÂÀ¢6÷W&6T6öçFW‡EFVæçD–C¢&VÆ”6öÖÖæEFVæçD–BÇÂFVæçD–BÀ¢6÷W&6UW6W$æÖS¢7GVÅW6W&æÖRÀ¢6÷W&6UW6W$–C¢7G&–ær‡Fw3òå²wW6W"Ö–BuÒÇÂrr’çG&–Ò‚’ÇÂVæFVf–æVBÀ¢7V¶W#¢&VÆ”6öÖÖæD&÷BÀ¢7V¶W%FVæçD–C¢&VÆ”6öÖÖæEFVæçD–BÀ¢ÖW76vS¢7GVÄÖW76vRÀ¢&÷DæÖW3¢&VÆ”&÷DæÖW2À¢Ò“°¢–b‡&VÆ•&WÇ’æÖF6†VB’°¢6öç7BW‡Æ–6—FÇ”FG&W76VBÒFG&W76VEFõ&W7öç6T&÷BÇÂ&ööÆVâ†ÆVF–ætÆ÷&T&÷B“°¢–b‡&VÆ•&WÇ’æ6Æ÷6VB’°¢v—B6VæD6†DÖW76vR€¢&VÆ’6Æ÷6VBâ’vöâwB6VæBç—F†–ær&6²FòG·&VÆ•&WÇ’çF&vWDæÖRÇÂwF†R÷&–v–æÂ6VæFW"wÒæÀ¢v&÷BrÀ¢&WÇ”6†ææVÂÀ¢&VÆ”6öÖÖæEFVæçD–@¢’æ6F6‚‚‚’Óâ·Ò“°¢&WGW&ã°¢Ğ¢–b‡&VÆ•&WÇ’æÖ—76–ætÖW76vR’°¢v—B6VæD6†DÖW76vR€¢FB–÷W"ÖW76vRgFW"'&WÇ’"÷"'–W2"Â÷"FVÆÂÖR&æò"Fò6Æ÷6RF†R&VÆ’æÀ¢v&÷BrÀ¢&WÇ”6†ææVÂÀ¢&VÆ”6öÖÖæEFVæçD–@¢’æ6F6‚‚‚’Óâ·Ò“°¢&WGW&ã°¢Ğ¢–b‡&VÆ•&WÇ’æFVÆ—fW&VB’°¢v—B6VæD6†DÖW76vR€¢–÷W"&WÇ’v26VçB&6²FòG·&VÆ•&WÇ’çF&vWDæÖRÇÂwF†R÷&–v–æÂ6VæFW"wÒBF†R÷&–v–æÂÆö6F–öââF†W’&V6V—fVBF†R6ÖR&WÇ’÷F–öç2æÀ¢v&÷BrÀ¢&WÇ”6†ææVÂÀ¢&VÆ”6öÖÖæEFVæçD–@¢’æ6F6‚‚‚’Óâ·Ò“°¢&WGW&ã°¢Ğ¢–b†W‡Æ–6—FÇ”FG&W76VB’°¢v—B6VæD6†DÖW76vR€¢&VÆ•&WÇ’æW'&÷"ÓÓÒvæò×VæF–ær×&VÆ’p¢òuF†W&R—2æò7F—fR&VÆ’f÷"–÷R–âF†—26†ææVÂâ&VÆ’–çf—FF–öç2W‡—&RgFW"Ö–çWFW2âp¢¢’6÷VÆFâwB6VæBF†B&WÇ“¢G·&VÆ•&WÇ’æW'&÷"ÇÂwVæ¶æ÷vâ&VÆ’W'&÷"wÖÀ¢v&÷BrÀ¢&WÇ”6†ææVÂÀ¢&VÆ”6öÖÖæEFVæçD–@¢’æ6F6‚‚‚’Óâ·Ò“°¢&WGW&ã°¢Ğ¢Ğ¢Ğ ¢–b†—4‡VÖå7V¶W"bb†FG&W76VEFõ&W7öç6T&÷BÇÂÆVF–ætÆ÷&T&÷B’’°¢6öç7BÆ÷&RÒv—B&VEv÷&ÆDÆ÷&R‚“°¢6öç7B&VÆ”6†&7FW'2Òö&¦V7BçfÇVW2†Æ÷&Sòæ6†&7FW'2ÇÂ·Ò“°¢6öç7B‡VÖå&VÆ•7V¶W"Òv—B&W6öÇfT‡VÖå&VÆ•7V¶W"‡°¢6÷W&6UÆFf÷&Ó¢wGv—F6‚rÀ¢6÷W&6UW6W$æÖS¢7GVÅW6W&æÖRÀ¢6÷W&6UW6W$–C¢7G&–ær‡Fw3òå²wW6W"Ö–BuÒÇÂrr’çG&–Ò‚’ÇÂVæFVf–æVBÀ¢Ò“°¢6öç7B&VÆ•F&vWG2Ò&VÆ”6†&7FW'2æf–ÇFW"€¢‡F&vWB’ÓâF&vWBç7F&ÆT–BÓÒ‡VÖå&VÆ•7V¶W"æ6†&7FW"ç7F&ÆT–BÀ¢“°¢–b†Æö6Å&VÆ•F&vWB’°¢6öç7B6öçFW‡GVÄÆö6ÅF&vWBÒ°¢ââæÆö6Å&VÆ•F&vWBÀ¢Æ–6W3¢'&’æg&öÒ†æWr6WB…°¢v†W"&÷BrÀ¢wF†V—"&÷BrÀ¢wF†R7G&VÖW"rÀ¢wF†R6†ææVÂ÷væW"rÀ¢v†W"rÀ¢âââ†Æö6Å&VÆ•F&vWBæÆ–6W2ÇÂµÒ’À¢Ò’’À¢Ó°¢6öç7BW†—7F–æuF&vWD–æFW‚Ò&VÆ•F&vWG2æf–æD–æFW‚‚‡F&vWB’ÓâF&vWBç7F&ÆT–BÓÓÒ6öçFW‡GVÄÆö6ÅF&vWBç7F&ÆT–B“°¢–b†W†—7F–æuF&vWD–æFW‚ãÒ’&VÆ•F&vWG5¶W†—7F–æuF&vWD–æFW…ÒÒ6öçFW‡GVÄÆö6ÅF&vWC°¢VÇ6R&VÆ•F&vWG2çW6‚†6öçFW‡GVÄÆö6ÅF&vWB“°¢Ğ¢6öç7B&VÆ•&WVW7BÒv—BFWFV7D&÷E&VÆ•&WVW7Ev—F„’‡°¢ÖW76vS¢7GVÄÖW76vRÀ¢7V¶W$æÖS¢&VÆ”6öÖÖæD&÷Bæ7W'&VçDæÖRÀ¢F&vWG3¢&VÆ•F&vWG2À¢FVæçD–C¢&VÆ”6öÖÖæEFVæçD–BÀ¢ÆFf÷&Ó¢wGv—F6‚rÀ¢Ò“°¢–b‡&VÆ•&WVW7BæÖF6†VBbb&VÆ•&WVW7Bç&VÆ”ÖW76vR’°¢6öç6öÆRæÆör‚u´F—7F6†W%Ò‡VÖâ&VÆ’–çFVçBFWFV7FVC¢rÂ°¢6÷W&6S¢&VÆ•&WVW7Bç6÷W&6RÇÂwVæ¶æ÷vârÀ¢6öÖÖæD&÷C¢&VÆ”6öÖÖæD&÷Bæ7W'&VçDæÖRÀ¢FVÆ—fW'•7V¶W#¢‡VÖå&VÆ•7V¶W"æ6†&7FW"æ7W'&VçDæÖRÀ¢6öÖ×Væ—G”fÆÆ&6³¢‡VÖå&VÆ•7V¶W"çW6W46öÖ×Væ—G”&÷BÀ¢F&vWDæÖS¢&VÆ•&WVW7BçF&vWDæÖRÇÂ&VÆ•&WVW7BçF&vWCòæ7W'&VçDæÖRÇÂçVÆÂÀ¢ÖW76vU&Wf–Ws¢&VÆ•&WVW7Bç&VÆ”ÖW76vRç6Æ–6RƒÂ#’À¢Ò“°¢6öç7B&W6öÇfVE&VÆ•F&vWBÒv—B&W6öÇfU&VÆ•F&vWB‡°¢æÖVEF&vWC¢&VÆ•&WVW7BçF&vWDæÖRÀ¢7G'V7GW&VEF&vWC¢&VÆ•&WVW7BçF&vWBÀ¢fÆÆ&6µFVæçD–C¢&VÆ”6öÖÖæEFVæçD–BÀ¢Ò“°¢–b‚&W6öÇfVE&VÆ•F&vWB’°¢–b‡&VÆ•&WVW7BçF&vWDæÖRbb—4F—&V7D‡VÖå&VÆ•F&vWB‡&VÆ•&WVW7BçF&vWDæÖR’’°¢6öç7BF—&V7DÖW76vRÒ'V–ÆDF—&V7D‡VÖå&VÆ”ÖW76vR‡°¢F&vWDæÖS¢&VÆ•&WVW7BçF&vWDæÖRÀ¢6÷W&6UW6W$æÖS¢7GVÅW6W&æÖRÀ¢&VÆ”ÖW76vS¢&VÆ•&WVW7Bç&VÆ”ÖW76vRÀ¢Ò“°¢6öç6öÆRæÆör‚u´F—7F6†W%Ò&VÆ’FVÆ—fW&VBF—&V7FÇ’Fò‡VÖâF&vWB–â7W'&VçBGv—F6‚6†C¢rÂ°¢F&vWDæÖS¢&VÆ•&WVW7BçF&vWDæÖRÀ¢&WÇ”6†ææVÂÀ¢6÷W&6S¢&VÆ•&WVW7Bç6÷W&6RÇÂwVæ¶æ÷vârÀ¢Ò“°¢v—B6VæD6†DÖW76vR€¢F—&V7DÖW76vRÀ¢v&÷BrÀ¢&WÇ”6†ææVÂÀ¢‡VÖå&VÆ•7V¶W"çFVæçD–@¢’æ6F6‚‚‚’Óâ·Ò“°¢&WGW&ã°¢Ğ¢6öç6öÆRçv&â‚u´F—7F6†W%Ò‡VÖâ&VÆ’F&vWBVç&W6öÇfVC¢rÂ°¢F&vWDæÖS¢&VÆ•&WVW7BçF&vWDæÖRÇÂ&VÆ•&WVW7BçF&vWCòæ7W'&VçDæÖRÇÂçVÆÂÀ¢G&–vvW$ÖW76vS¢7GVÄÖW76vRÀ¢Ò“°¢v—B6VæD6†DÖW76vR€¢’6÷VÆFâwBf–wW&R÷WBv†–6‚&÷B÷"7G&VÖW"Fò72F†BFòæÀ¢v&÷BrÀ¢&WÇ”6†ææVÂÀ¢‡VÖå&VÆ•7V¶W"çFVæçD–@¢’æ6F6‚‚‚’Óâ·Ò“°¢&WGW&ã°¢Ğ ¢6öç7B&VÆ•&W7VÇBÒv—BFVÆ—fW$&÷E&VÆ’‡°¢6÷W&6UÆFf÷&Ó¢wGv—F6‚rÀ¢6÷W&6T6†ææVÄ–C¢&WÇ”6†ææVÂÀ¢6÷W&6T6öçFW‡EFVæçD–C¢FVæçD–BÀ¢6÷W&6UW6W$æÖS¢7GVÅW6W&æÖRÀ¢6÷W&6UW6W$–C¢7G&–ær‡Fw3òå²wW6W"Ö–BuÒÇÂrr’çG&–Ò‚’ÇÂVæFVf–æVBÀ¢G&–vvW$ÖW76vS¢7GVÄÖW76vRÀ¢7V¶W#¢‡VÖå&VÆ•7V¶W"æ6†&7FW"À¢7V¶W%FVæçD–C¢‡VÖå&VÆ•7V¶W"çFVæçD–BÀ¢F&vWC¢&W6öÇfVE&VÆ•F&vWBæ6†&7FW"À¢F&vWEFVæçD–C¢&W6öÇfVE&VÆ•F&vWBçFVæçD–BÀ¢&VÆ”ÖW76vS¢&VÆ•&WVW7Bç&VÆ”ÖW76vRÀ¢‡VÖäF—&V7FVC¢G'VRÀ¢Ò“°¢v—B6VæD6†DÖW76vR€¢&VÆ•&W7VÇBç7VÖÖ'’À¢v&÷BrÀ¢&WÇ”6†ææVÂÀ¢‡VÖå&VÆ•7V¶W"çFVæçD–@¢’æ6F6‚‚‚’Óâ·Ò“°¢&WGW&ã°¢Ğ¢Ğ ¢6öç7BFV6—6–öâÒv—BFV6–FT&÷D–çFW&7F–öâ‡°¢ÖW76vS¢7GVÄÖW76vRÀ¢7W'&VçD&÷DæÖS¢&W7öç6T&÷DæÖRÀ¢FVæçD–C¢&W7öç6UFVæçD–BÀ¢ÆFf÷&Ó¢wGv—F6‚rÀ¢FF—F–öæÄÖVçF–öç3¢W‡Æ–6—EGv—F6„&÷DÖVçF–öç2æÖ‚†VçG'’’Óâ‡°¢6†&7FW#¢VçG'’æ6†&7FW"À¢G&–vvW#¢VçG'’çG&–vvW"À¢Ò’’À¢ÆÆ÷vVE7V¶W%7F&ÆT–G3¢'&’æg&öÒ†ÆÆ÷vVEGv—F6…'F–6—çG2’À¢ÆÆ÷vVEF&vWE7F&ÆT–G3¢'&’æg&öÒ†ÆÆ÷vVEGv—F6…'F–6—çG2’À¢Ò“° ¢–b†FV6—6–öãòç6†÷VÆE&W7öæB’°¢–b†F†VæFVæ–VBbbFV6—6–öâç7V¶W"ç7F&ÆT–BÓÓÒD„Täõ5D$ÄUô”B’°¢6öç6öÆRæÆör†´F—7F6†W%ÒF†Væ7&÷72Ö&÷B&W7öç6R7W&W76VBf÷"æöâ×v†—FVÆ—7FVBW6W"G¶7GVÅW6W&æÖWÒ–â2G·&WÇ”6†ææVÇÖ“°¢ÒVÇ6R°¢6öç7B&VÆ•&WVW7BÒFWFV7D&÷E&VÆ•&WVW7B‡°¢ÖW76vS¢7GVÄÖW76vRÀ¢7V¶W$æÖS¢FV6—6–öâç7V¶W"æ7W'&VçDæÖRÀ¢F&vWG3¢FV6—6–öâçF&vWG2À¢Ò“°¢–b‡&VÆ•&WVW7BæÖF6†VBbb&VÆ•&WVW7Bç&VÆ”ÖW76vR’°¢6öç7B&W6öÇfVE&VÆ•F&vWBÒv—B&W6öÇfU&VÆ•F&vWB‡°¢æÖVEF&vWC¢&VÆ•&WVW7BçF&vWDæÖRÀ¢7G'V7GW&VEF&vWC¢&VÆ•&WVW7BçF&vWBÀ¢fÆÆ&6µFVæçD–C¢&W7öç6UFVæçD–BÀ¢Ò“°¢–b‡&W6öÇfVE&VÆ•F&vWB’°¢6öç7B&VÆ•&W7VÇBÒv—BFVÆ—fW$&÷E&VÆ’‡°¢6÷W&6UÆFf÷&Ó¢wGv—F6‚rÀ¢6÷W&6UW6W$æÖS¢7GVÅW6W&æÖRÀ¢G&–vvW$ÖW76vS¢7GVÄÖW76vRÀ¢7V¶W#¢FV6—6–öâç7V¶W"À¢7V¶W%FVæçD–C¢&W7öç6UFVæçD–BÀ¢F&vWC¢&W6öÇfVE&VÆ•F&vWBæ6†&7FW"À¢F&vWEFVæçD–C¢&W6öÇfVE&VÆ•F&vWBçFVæçD–BÀ¢&VÆ”ÖW76vS¢&VÆ•&WVW7Bç&VÆ”ÖW76vRÀ¢‡VÖäF—&V7FVC¢W6W$—4¶æ÷vä&÷BÀ¢Ò“°¢v—B6VæD6†DÖW76vR€¢&VÆ•&W7VÇBç7VÖÖ'’À¢v&÷BrÀ¢&WÇ”6†ææVÂÀ¢&W7öç6UFVæçD–@¢’æ6F6‚‚‚’Óâ·Ò“°¢&WGW&ã°¢Ğ¢Ğ ¢6öç6öÆRæÆör†´F—7F6†W%Ò7&÷72Ö&÷B–çFW&7F–öâG&–vvW&VC¢G¶FV6—6–öâç&V6öçÖ“°¢6öç7B&W7öç6RÒv—BfWF6‚†‡GG¢òó#rããã¢G·&ö6W72æVçbåõ%GÇÃ3Òö’ö’ö6†B×v—F‚ÖÖVÖ÷'–Â°¢ÖWF†öC¢uõ5BrÀ¢†VFW'3¢–çFW&æÅ6W'f–6T†VFW'2‡²t6öçFVçBÕG—Rs¢vÆ–6F–öâö§6öârÒ’À¢&öG“¢¥4ôâç7G&–æv–g’‡°¢W6W&æÖS¢7GVÅW6W&æÖRÀ¢F—7Æ”æÖS¢F—7Æ”æÖRÀ¢ÖW76vS¢FV6—6–öâç&ö×D–ç7G'V7F–öâÀ¢FVæçD–C¢&W7öç6UFVæçD–BÇÂVæFVf–æVBÀ¢6öçFW‡C¢wGv—F6‚rÀ¢Ò¢Ò“° ¢–b‡&W7öç6Ræö²’°¢6öç7BFFÒv—B&W7öç6Ræ§6öâ‚“°¢6öç7B•&WÇ’ÒFFç&W7öç6SòçG&–Ò‚’ÇÂFFæFFòç&W7öç6SòçG&–Ò‚’ÇÂrs°¢–b†•&WÇ’’°¢6öç7B&W7öç6T6†ææVÂÒv—B&W6öÇfUGv—F6…&WÇ”6†ææVÂ‡°¢6÷W&6T6†ææVÃ¢&WÇ”6†ææVÂÀ¢6÷W&6UFVæçD–C¢FVæçD–BÀ¢&W7öç6UFVæçD–BÀ¢Ò“°¢–b‡&W7öç6UFVæçD–BÓÓÒ54TÔõTåD”åõ5•5DTÕõDTäåEô”B’°¢6öç7BGG2Òv—BVWVUGG4÷fW&Æ’†•&WÇ’Â&W7öç6UFVæçD–B“°¢–b‚GG2æö²’6öç6öÆRçv&â‚u´F—7F6†W%Ò7FVÆÆ7—7FVÒ×FVæçBEE2VWVRf–ÆVC¢rÂGG2æW'&÷"“°¢ÒVÇ6R°¢v—B6VæD6†DÖW76vR†•&WÇ’Âv&÷BrÂ&W7öç6T6†ææVÂÂ&W7öç6UFVæçD–B’æ6F6‚‚‚’Óâ·Ò“°¢Ğ¢–b‡&W7öç6UFVæçD–B’°¢v—BVæD&÷D–çFW&7F–öâ‡°¢ÆFf÷&Ó¢wGv—F6‚rÀ¢FVæçD–C¢&W7öç6UFVæçD–BÀ¢6÷W&6UW6W#¢7GVÅW6W&æÖRÀ¢7V¶W$&÷D–C¢FV6—6–öâç7V¶W"ç7F&ÆT–BÀ¢7V¶W$&÷DæÖS¢FV6—6–öâç7V¶W"æ7W'&VçDæÖRÀ¢F&vWD&÷D–G3¢FV6—6–öâçF&vWG2æÖ‚‡F&vWC¢ç’’ÓâF&vWBç7F&ÆT–B’À¢F&vWD&÷DæÖW3¢FV6—6–öâçF&vWG2æÖ‚‡F&vWC¢ç’’ÓâF&vWBæ7W'&VçDæÖR’À¢G&–vvW$ÖW76vS¢7GVÄÖW76vRÀ¢&W7öç6TÖW76vS¢•&WÇ’À¢Ò’æ6F6‚‚‚’Óâ·Ò“°¢Ğ¢v—B6VæEGv—F6„7&÷74&÷DföÆÆ÷uW‡°¢6†ææVÃ¢&W7öç6T6†ææVÂÀ¢W6W$æÖS¢7GVÅW6W&æÖRÀ¢G&–vvW$ÖW76vS¢7GVÄÖW76vRÀ¢7V¶W$æÖS¢FV6—6–öâç7V¶W"æ7W'&VçDæÖRÀ¢7V¶W%7F&ÆT–C¢FV6—6–öâç7V¶W"ç7F&ÆT–BÀ¢7V¶W%FVæçD–C¢&W7öç6UFVæçD–BÀ¢7V¶W%&WÇ“¢•&WÇ’À¢F&vWG3¢FV6—6–öâçF&vWG2À¢Ò’æ6F6‚‚†W'&÷"’Óâ6öç6öÆRæW'&÷"‚u´F—7F6†W%ÒGv—F6‚7&÷72Ö&÷BföÆÆ÷r×Wf–ÆVC¢rÂW'&÷"’“°¢&WGW&ã°¢Ğ¢Ğ¢Ğ¢Ğ¢Ò6F6‚†W'"’°¢6öç6öÆRæW'&÷"‚u´F—7F6†W%Ò7&÷72Ö&÷B–çFW&7F–öâf–ÆVC¢rÂW'"“°¢Ğ ¢ÆWBÖVçF–öç4&÷BÒÖVçF–öåG&–vvW'2ç6öÖR‡G&–vvW"ÓâÆ÷vW$ÖW76vRæ–æ6ÇVFW2‡G&–vvW"’“°¢–b‚ÖVçF–öç4&÷Bbb&W7öç6UFVæçD–B’°¢6öç7B²†5VæF–æu&W6V&6„ÖöFRÒÒv—B–×÷'B‚râ÷&W6V&6‚ÖÖöFRr“°¢ÖVçF–öç4&÷BÒ†5VæF–æu&W6V&6„ÖöFR‡°¢FVæçD–C¢&W7öç6UFVæçD–BÀ¢ÆFf÷&Ó¢wGv—F6‚rÀ¢6†ææVÄ–C¢&WÇ”6†ææVÂÀ¢W6W&æÖS¢7GVÅW6W&æÖRÀ¢Ò“°¢–b†ÖVçF–öç4&÷B’°¢6öç6öÆRæÆör†´F—7F6†W%Ò6öçF–çV–ærVæF–ær&W6V&6‚VW7F–öâf÷"G¶7GVÅW6W&æÖWÒ–â2G·&WÇ”6†ææVÇÖ“°¢Ğ¢Ğ¢ ¢òò&VÖ÷fR†&F6öFVBF†Væ6†V6²ÒöæÇ’W6RG–æÖ–2&÷BæÖP¢–b†ÖVçF–öç4&÷B’°¢6öç6öÆRæÆör†´F—7F6†W%ÒG¶&÷DæÖWÒÖVçF–öæVB'’G¶7GVÅW6W&æÖWÓ¢G¶7GVÄÖW76vWÖ“°¢ÒVÇ6R°¢òò6†V6²–bÖW76vR6öçF–ç2&÷B–çFW&W7G2ƒSR6†æ6RFò&W7öæB¢6öç7B&÷D–çFW&W7G2ÒvWD&÷D–çFW&W7G2‡FVæçD–B’ÇÂrs°¢–b†&÷D–çFW&W7G2bbÖF‚ç&æFöÒ‚’ÂãR’°¢6öç7B–çFW&W7G2Ò&÷D–çFW&W7G2çFôÆ÷vW$66R‚’ç7Æ—B‚rÂr’æÖ‚†“¢7G&–ær’Óâ’çG&–Ò‚’“°¢6öç7B†4–çFW&W7BÒ–çFW&W7G2ç6öÖR‚†–çFW&W7C¢7G&–ær’ÓâÆ÷vW$ÖW76vRæ–æ6ÇVFW2†–çFW&W7B’“°¢ ¢–b††4–çFW&W7B’°¢6öç6öÆRæÆör†´F—7F6†W%Ò–çFW&W7BFWFV7FVB–âÖW76vRg&öÒG¶7GVÅW6W&æÖWÓ¢G¶7GVÄÖW76vWÖ“°¢ÖVçF–öç4&÷BÒG'VS°¢Ğ¢Ğ¢Ğ¢ ¢–b†ÖVçF–öç4&÷B’°¢ ¢–æ7&VÖVçDÖWG&–2‚vF†Væ6öÖÖæG2rÂÂFVæçD–B’æ6F6‚‚‚’Óâ·Ò“°¢òòW6R6†B×v—F‚ÖÖVÖ÷'’’f÷"6öçFW‡BÖv&R&W7öç6W0¢G'’°¢6öç6öÆRæÆör‚u´F—7F6†W%Ò6ÆÆ–ær6†B×v—F‚ÖÖVÖ÷'’’âââr“°¢ ¢ÆWBÖW76vUFõ6VæBÒ7GVÄÖW76vS°¢ ¢6öç7B&W7öç6RÒv—BfWF6‚†‡GG¢òó#rããã¢G·&ö6W72æVçbåõ%GÇÃ3Òö’ö’ö6†B×v—F‚ÖÖVÖ÷'–Â°¢ÖWF†öC¢uõ5BrÀ¢†VFW'3¢–çFW&æÅ6W'f–6T†VFW'2‡²t6öçFVçBÕG—Rs¢vÆ–6F–öâö§6öârÒ’À¢&öG“¢¥4ôâç7G&–æv–g’‡°¢W6W&æÖS¢7GVÅW6W&æÖRÀ¢ÖW76vS¢ÖW76vUFõ6VæBÀ¢FVæçD–C¢&W7öç6UFVæçD–BÇÂVæFVf–æVBÀ¢6†ææVÄ–C¢&WÇ”6†ææVÂÀ¢6öçFW‡C¢ÖW76vRæ–æ6ÇVFW2‚	øÉòr’òwfö–6Rr¢wGv—F6‚rÀ¢Ò¢Ò“°¢ ¢6öç6öÆRæÆör‚u´F—7F6†W%Ò6†B×v—F‚ÖÖVÖ÷'’&W7öç6R7FGW3¢rÂ&W7öç6Rç7FGW2“°¢ ¢–b‡&W7öç6Ræö²’°¢6öç7BFFÒv—B&W7öç6Ræ§6öâ‚“°¢6öç7B•&WÇ’ÒFFç&W7öç6SòçG&–Ò‚’ÇÂrs°¢6öç6öÆRæÆör‚u´F—7F6†W%Ò6†B×v—F‚ÖÖVÖ÷'’&WÇ“¢rÂ•&WÇ’“°¢ ¢–b†•&WÇ’’°¢òò6VæBF†R6†BÖW76vP¢6öç7B&W7öç6T6†ææVÂÒv—B&W6öÇfUGv—F6…&WÇ”6†ææVÂ‡°¢6÷W&6T6†ææVÃ¢&WÇ”6†ææVÂÀ¢6÷W&6UFVæçD–C¢FVæçD–BÀ¢&W7öç6UFVæçD–BÀ¢Ò“°¢6öç7B—57FVÆÆ7—7FVÕ&WÇ’Ò&W7öç6UFVæçD–BÓÓÒ54TÔõTåD”åõ5•5DTÕõDTäåEô”C°¢–b‚—57FVÆÆ7—7FVÕ&WÇ’’°¢v—B6VæD6†DÖW76vR†•&WÇ’Âv&÷BrÂ&W7öç6T6†ææVÂÂ&W7öç6UFVæçD–B’æ6F6‚‚‚’Óâ·Ò“°¢Ğ¢6öç7B6†÷VÆDvVæW&FUGG4f÷%&WÇ’Ò&W7öç6UFVæçD–BÇÂ&W7öç6UFVæçD–BÓÓÒFVæçD–C°¢v—B6VæEGv—F6„7&÷74&÷DföÆÆ÷uW‡°¢6†ææVÃ¢&W7öç6T6†ææVÂÀ¢W6W$æÖS¢7GVÅW6W&æÖRÀ¢G&–vvW$ÖW76vS¢7GVÄÖW76vRÀ¢7V¶W$æÖS¢&W7öç6T&÷DæÖRÀ¢7V¶W%7F&ÆT–C¢f—'7DÆ÷&T&÷Còç7F&ÆT–BÀ¢7V¶W%FVæçD–C¢&W7öç6UFVæçD–BÀ¢7V¶W%&WÇ“¢•&WÇ’À¢F&vWG3¢µÒÀ¢Ò’æ6F6‚‚†W'&÷"’Óâ6öç6öÆRæW'&÷"‚u´F—7F6†W%ÒGv—F6‚7&÷72Ö&÷BföÆÆ÷r×Wf–ÆVC¢rÂW'&÷"’“°¢ ¢òòvVæW&FREE2f÷"’&W7öç6P¢–b‡6†÷VÆDvVæW&FUGG4f÷%&WÇ’’°¢G'’°¢6öç7BF&vWEFVæçBÒ&W7öç6UFVæçD–BÇÂFVæçD–BÇÂVæFVf–æVC°¢6öç7BGG2Òv—BVWVUGG4÷fW&Æ’†•&WÇ’ÂF&vWEFVæçB“°¢–b‚GG2æö²’°¢6öç6öÆRçv&â‚u´F—7F6†W%ÒEE2÷fW&Æ’VWVRf–ÆVBf÷"’&W7öç6S¢rÂGG2æW'&÷"“°¢Ğ¢Ò6F6‚†W'"’°¢6öç6öÆRæW'&÷"‚u´F—7F6†W%ÒEE2vVæW&F–öâf–ÆVBf÷"’&W7öç6S¢rÂW'"“°¢Ğ¢ÒVÇ6R°¢6öç6öÆRæÆör†´F—7F6†W%Ò6¶—–ærEE2f÷"7&÷72×7G&VÒ&÷B&WÇ’g&öÒFVæçBG·&W7öç6UFVæçD–GÒ–âFVæçBG·FVæçD–BÇÂwVæ¶æ÷vâwÒæ“°¢Ğ¢Ğ¢ÒVÇ6R°¢6öç7BW'&÷%FW‡BÒv—B&W7öç6RçFW‡B‚“°¢6öç6öÆRæW'&÷"‚u´F—7F6†W%Ò6†B×v—F‚ÖÖVÖ÷'’’W'&÷#¢rÂ&W7öç6Rç7FGW2ÂW'&÷%FW‡B“°¢Ğ¢Ò6F6‚†W'"’°¢6öç6öÆRæW'&÷"†´F—7F6†W%ÒG¶&÷DæÖWÒ6†Bf–ÆVC¦ÂW'"“°¢Ğ¢Ğ¢Ğ¢Ğ§Ğ ¦gVæ7F–öâæ÷&ÖÆ—¦TF—66÷&DGF6†ÖVçG4f÷$ÖVÖ÷'’†×6s¢ç’’°¢&WGW&â'&’æ—4'&’†×6ræGF6†ÖVçG2¢ò×6ræGF6†ÖVçG0¢æÖ‚†GF6†ÖVçC¢ç’’Óâ‡°¢–C¢7G&–ær†GF6†ÖVçCòæ–BÇÂGF6†ÖVçCòçW&ÂÇÂGF6†ÖVçCòæf–ÆVæÖRÇÂrr’À¢W&Ã¢7G&–ær†GF6†ÖVçCòçW&ÂÇÂGF6†ÖVçCòç&÷‡•÷W&ÂÇÂrr’À¢f–ÆVæÖS¢7G&–ær†GF6†ÖVçCòæf–ÆVæÖRÇÂGF6†ÖVçCòææÖRÇÂvGF6†ÖVçBr’À¢6öçFVçE÷G—S¢GF6†ÖVçCòæ6öçFVçE÷G—Rò7G&–ær†GF6†ÖVçBæ6öçFVçE÷G—R’¢VæFVf–æVBÀ¢Ò’¢æf–ÇFW"‚†GF6†ÖVçC¢²W&Ã¢7G&–ærÒ’ÓâGF6†ÖVçBçW&Â¢¢µÓ°§Ğ ¦W‡÷'B7–æ2gVæ7F–öâ—4&÷E&VÆ”ÆÆ÷vVB‡6÷W&6UFVæçD–Có¢7G&–ærÂF&vWEFVæçD–Có¢7G&–ær“¢&öÖ—6SÆ&ööÆVãâ°¢–b‚6÷W&6UFVæçD–BÇÂF&vWEFVæçD–B’&WGW&âfÇ6S°¢6öç7B²vWD&÷E6†&TÖöFRÒÒv—B–×÷'B‚rââöÆ–"ö&÷BÖ–çFW&7F–öç2×7F÷&Rr“°¢–b†v—BvWD&÷E6†&TÖöFR‡6÷W&6UFVæçD–B’ÓÒvöâr’&WGW&âfÇ6S°¢–b‡6÷W&6UFVæçD–BÓÓÒF&vWEFVæçD–B’&WGW&âG'VS°¢&WGW&âv—BvWD&÷E6†&TÖöFR‡F&vWEFVæçD–B’ÓÓÒvöâs°§Ğ ¦gVæ7F–öâæ÷&ÖÆ—¦TF—66÷&DVÖ&VG4f÷$ÖVÖ÷'’†×6s¢ç’’°¢&WGW&â'&’æ—4'&’†×6ræVÖ&VG2¢ò×6ræVÖ&VG0¢æÖ‚†VÖ&VC¢ç’’Óâ‡°¢F—FÆS¢VÖ&VCòçF—FÆRò7G&–ær†VÖ&VBçF—FÆR’¢VæFVf–æVBÀ¢FW67&—F–öã¢VÖ&VCòæFW67&—F–öâò7G&–ær†VÖ&VBæFW67&—F–öâ’¢VæFVf–æVBÀ¢W&Ã¢VÖ&VCòçW&Âò7G&–ær†VÖ&VBçW&Â’¢VæFVf–æVBÀ¢–ÖvS¢VÖ&VCòæ–ÖvSòçW&Âò²W&Ã¢7G&–ær†VÖ&VBæ–ÖvRçW&Â’Ò¢VæFVf–æVBÀ¢F‡VÖ&æ–Ã¢VÖ&VCòçF‡VÖ&æ–ÃòçW&Âò²W&Ã¢7G&–ær†VÖ&VBçF‡VÖ&æ–ÂçW&Â’Ò¢VæFVf–æVBÀ¢Ò’¢æf–ÇFW"‚†VÖ&VC¢²F—FÆSó¢7G&–æs²FW67&—F–öãó¢7G&–æs²W&Ãó¢7G&–æs²–ÖvSó¢²W&Ãó¢7G&–ærÓ²F‡VÖ&æ–Ãó¢²W&Ãó¢7G&–ærÒÒ’ÓâVÖ&VBçF—FÆRÇÂVÖ&VBæFW67&—F–öâÇÂVÖ&VBçW&ÂÇÂVÖ&VBæ–ÖvSòçW&ÂÇÂVÖ&VBçF‡VÖ&æ–ÃòçW&Â¢¢µÓ°§Ğ ¦W‡÷'B7–æ2gVæ7F–öâ†æFÆTF—66÷&DÖW76vR†×6s¢ç’ÂFVæçD–Có¢7G&–ærÂ÷F–öç3¢F—66÷&DF—7F6„÷F–öç2Ò·Ò“¢&öÖ—6SÇ²6öÖÖæD†æFÆVC¢&ööÆVâÓâ°¢6öç7B6÷W&6T6†ææVÄ–BÒ×6ræ6†ææVÄ–BÇÂ×6ræ6†ææVÅö–C°¢–b‚6÷W&6T6†ææVÄ–B’&WGW&â²6öÖÖæD†æFÆVC¢fÇ6RÓ° ¢×6rÒ°¢ââæ×6rÀ¢6öçFVçC¢&WÆ6TF—66÷&EW6W$ÖVçF–öç2†×6ræ6öçFVçBÂ×6ræÖVçF–öç2’À¢Ó°¢6öç7B6÷W&6UW6W$æÖRÒ×6ræWF†÷#òçW6W&æÖRÇÂ×6ræWF†÷#òævÆö&ÄæÖRÇÂ×6ræWF†÷#òævÆö&ÅöæÖRÇÂtF—66÷&BW6W"s°¢6öç7Bæ÷&ÖÆ—¦VD6öçFVçBÒ7G&–ær†×6ræ6öçFVçBÇÂrr’çG&–Ò‚“° ¢–b‚×6ræWF†÷#òæ&÷Bbbæ÷&ÖÆ—¦VD6öçFVçBbbæ÷&ÖÆ—¦VD6öçFVçBç7F'G5v—F‚‚u²r’’°¢6öç7B×Df—„—D–çFVçBÒFWFV7D×Df—„—D–çFVçB†æ÷&ÖÆ—¦VD6öçFVçB“°¢–b†×Df—„—D–çFVçBæÖF6†VB’°¢–b‚×Df—„—D–çFVçBæFW67&—F–öâ’°¢&Vv–åVæF–æt×E7W÷'E&WVW7B‡°¢ÆFf÷&Ó¢vF—66÷&BrÀ¢FVæçD–BÀ¢W6W&æÖS¢6÷W&6UW6W$æÖRÀ¢6†ææVÄ–C¢6÷W&6T6†ææVÄ–BÀ¢Ò“°¢v—B6VæDF—66÷&DÖW76vR‡6÷W&6T6†ææVÄ–BÂG·6÷W&6UW6W$æÖWÒÂG¶vWD×E7W÷'E&ö×B‚vF—66÷&Br—Ö’æ6F6‚‚‚’Óâ·Ò“°¢&WGW&â²6öÖÖæD†æFÆVC¢G'VRÓ°¢Ğ ¢6öç7B–æÆ–æU&VÆ•&W7VÇBÒv—B7V&Ö—D×E7W÷'E&W÷'B‡°¢ÆFf÷&Ó¢vF—66÷&BrÀ¢FVæçD–BÀ¢W6W&æÖS¢6÷W&6UW6W$æÖRÀ¢&W÷'FW$–C¢7G&–ær†×6ræWF†÷#òæ–BÇÂrr’À¢6†ææVÄ–C¢6÷W&6T6†ææVÄ–BÀ¢FW67&—F–öã¢×Df—„—D–çFVçBæFW67&—F–öâÀ¢G&–vvW$ÖW76vS¢æ÷&ÖÆ—¦VD6öçFVçBÀ¢Ò“°¢–b‚–æÆ–æU&VÆ•&W7VÇBæö²’6öç6öÆRæW'&÷"‚u´×Df—„—EÒF—66÷&B&VÆ’–æÆ–æR&W÷'Bf–ÆVC¢rÂ–æÆ–æU&VÆ•&W7VÇBæW'&÷"“°¢v—B6VæDF—66÷&DÖW76vR‡6÷W&6T6†ææVÄ–BÂvWD×Df—„—EV&Æ–5&WÇ’‡6÷W&6UW6W$æÖR’’æ6F6‚‚‚’Óâ·Ò“°¢&WGW&â²6öÖÖæD†æFÆVC¢G'VRÓ°¢Ğ ¢–b†6öç7VÖUVæF–æt×E7W÷'E&WVW7B‡°¢ÆFf÷&Ó¢vF—66÷&BrÀ¢FVæçD–BÀ¢W6W&æÖS¢6÷W&6UW6W$æÖRÀ¢6†ææVÄ–C¢6÷W&6T6†ææVÄ–BÀ¢Ò’’°¢6öç7BVæF–æu&VÆ”FW67&—F–öâÒæ÷&ÖÆ—¦VD6öçFVçBç7F'G5v—F‚‚rr’òæ÷&ÖÆ—¦VD6öçFVçBç6Æ–6Rƒ’çG&–Ò‚’¢æ÷&ÖÆ—¦VD6öçFVçC°¢6öç7BVæF–æu&VÆ•&W7VÇBÒv—B7V&Ö—D×E7W÷'E&W÷'B‡°¢ÆFf÷&Ó¢vF—66÷&BrÀ¢FVæçD–BÀ¢W6W&æÖS¢6÷W&6UW6W$æÖRÀ¢&W÷'FW$–C¢7G&–ær†×6ræWF†÷#òæ–BÇÂrr’À¢6†ææVÄ–C¢6÷W&6T6†ææVÄ–BÀ¢FW67&—F–öã¢VæF–æu&VÆ”FW67&—F–öâÀ¢G&–vvW$ÖW76vS¢r×Ff—†—BrÀ¢Ò“°¢–b‚VæF–æu&VÆ•&W7VÇBæö²’6öç6öÆRæW'&÷"‚u´×Df—„—EÒF—66÷&B&VÆ’VæF–ærÖFW67&—F–öâ&W÷'Bf–ÆVC¢rÂVæF–æu&VÆ•&W7VÇBæW'&÷"“°¢v—B6VæDF—66÷&DÖW76vR‡6÷W&6T6†ææVÄ–BÂvWD×Df—„—EV&Æ–5&WÇ’‡6÷W&6UW6W$æÖR’’æ6F6‚‚‚’Óâ·Ò“°¢&WGW&â²6öÖÖæD†æFÆVC¢G'VRÓ°¢Ğ¢Ğ ¢6öç7BÖVÖ÷'”GF6†ÖVçG2Òæ÷&ÖÆ—¦TF—66÷&DGF6†ÖVçG4f÷$ÖVÖ÷'’†×6r“°¢6öç7BÖVÖ÷'”VÖ&VG2Òæ÷&ÖÆ—¦TF—66÷&DVÖ&VG4f÷$ÖVÖ÷'’†×6r“°¢–b‚÷F–öç2ç6¶—V&Æ–4†—7F÷'’bb×6ræWF†÷#òæ&÷Bbb7G&–ær†×6ræ6öçFVçBÇÂrr’ç7F'G5v—F‚‚u²r’bb…7G&–ær†×6ræ6öçFVçBÇÂrr’çG&–Ò‚’ÇÂÖVÖ÷'”GF6†ÖVçG2æÆVæwF‚ÇÂÖVÖ÷'”VÖ&VG2æÆVæwF‚’’°¢VæEV&Æ–46†DÖW76vW2…·°¢G—S¢wW6W"rÀ¢W6W&æÖS¢6÷W&6UW6W$æÖRÀ¢ÖW76vS¢7G&–ær†×6ræ6öçFVçB’À¢F–ÖW7F×¢æWrFFR‚’çFô•4õ7G&–ær‚’À¢âââ†ÖVÖ÷'”GF6†ÖVçG2æÆVæwF‚ò²GF6†ÖVçG3¢ÖVÖ÷'”GF6†ÖVçG2Ò¢·Ò’À¢âââ†ÖVÖ÷'”VÖ&VG2æÆVæwF‚ò²VÖ&VG3¢ÖVÖ÷'”VÖ&VG2Ò¢·Ò’À¢ÕÒÂ3ÂFVæçD–B’æ6F6‚‚‚’Óâ·Ò“°¢Ğ ¢–b‚õâ&÷G6†&Rƒó¥Ç2²†öçÆöfgÇ7FGW2’“òBö’çFW7B†×6ræ6öçFVçBçG&–Ò‚’’’°¢6öç7BÖF6‚Ò×6ræ6öçFVçBçG&–Ò‚’çFôÆ÷vW$66R‚’æÖF6‚‚õâ&÷G6†&Rƒó¥Ç2²†öçÆöfgÇ7FGW2’“òBò“°¢6öç7B7F–öâÒÖF6ƒòå³Ó°¢G'’°¢6öç7B7F÷&RÒv—B–×÷'B‚rââöÆ–"ö&÷BÖ–çFW&7F–öç2×7F÷&Rr“°¢ÆWBÖöFS°¢–b†7F–öâÓÓÒvöârÇÂ7F–öâÓÓÒvöfbr’°¢ÖöFRÒv—B7F÷&Rç6WD&÷E6†&TÖöFR†7F–öâÂFVæçD–B“°¢ÒVÇ6R–b†7F–öâÓÓÒw7FGW2r’°¢ÖöFRÒv—B7F÷&RævWD&÷E6†&TÖöFR‡FVæçD–B“°¢ÒVÇ6R°¢ÖöFRÒv—B7F÷&RçFövvÆT&÷E6†&TÖöFR‡FVæçD–B“°¢Ğ¢v—B6VæDF—66÷&DÖW76vR€¢6÷W&6T6†ææVÄ–BÀ¢&÷B6†&RÖöFS¢Gµ7G&–ær†ÖöFR’çFõWW$66R‚—ÒÒ7&÷72Ö&÷B&WÆ–W2&RG¶ÖöFRÓÓÒvöâròvVæ&ÆVBr¢vF—6&ÆVBwÒæÀ¢’æ6F6‚‚†W'&÷"’Óâ6öç6öÆRæW'&÷"‚u´F—66÷&B'&–FvUÒf–ÆVBFò&WÇ’Fò&÷G6†&S¢rÂW'&÷"’“°¢Ò6F6‚†W'&÷"’°¢6öç6öÆRæW'&÷"‚u´F—66÷&B'&–FvUÒ&÷G6†&R6öÖÖæBf–ÆVC¢rÂW'&÷"“°¢Ğ¢&WGW&â²6öÖÖæD†æFÆVC¢G'VRÓ°¢Ğ ¢–b‚×6ræWF†÷#òæ&÷B’°¢6öç7B6öÖÖæD†æFÆVBÒv—BW†V7WFTF—66÷&D6öÖÖæDÖW76vR‡°¢ââæ×6rÀ¢6†ææVÄ–C¢6÷W&6T6†ææVÄ–BÀ¢ÒÂFVæçD–BÂ÷F–öç2“°¢–b†6öÖÖæD†æFÆVB’°¢&WGW&â²6öÖÖæD†æFÆVC¢G'VRÓ°¢Ğ¢Ğ ¢–b‚÷F–öç2ç6¶—”ÖVçF–öç2bb×6ræ6öçFVçBç7F'G5v—F‚‚u²r’bb×6ræWF†÷"bb×6ræWF†÷"æ&÷B’°¢G'’°¢6öç7B²vWD&÷DæÖRÒÒ&WV—&R‚rââöÆ–"ö&÷B×6WGF–æw2×7F÷&Rr“°¢6öç7B²FV6–FT&÷D–çFW&7F–öâÂVæD&÷D–çFW&7F–öâÒÒv—B–×÷'B‚rââöÆ–"ö&÷BÖ–çFW&7F–öç2×7F÷&Rr“°¢6öç7B&÷DæÖRÒvWD&÷DæÖR‡FVæçD–B“°¢6öç7BFV6—6–öâÒv—BFV6–FT&÷D–çFW&7F–öâ‡°¢ÖW76vS¢×6ræ6öçFVçBÀ¢7W'&VçD&÷DæÖS¢&÷DæÖRÀ¢FVæçD–BÀ¢ÆFf÷&Ó¢vF—66÷&BrÀ¢Ò“° ¢–b†FV6—6–öãòç6†÷VÆE&W7öæB’°¢6öç7B&W7öç6RÒv—BfWF6‚†‡GG¢òó#rããã¢G·&ö6W72æVçbåõ%GÇÃ3Òö’ö’ö6†B×v—F‚ÖÖVÖ÷'–Â°¢ÖWF†öC¢uõ5BrÀ¢†VFW'3¢–çFW&æÅ6W'f–6T†VFW'2‡²t6öçFVçBÕG—Rs¢vÆ–6F–öâö§6öârÒ’À¢&öG“¢¥4ôâç7G&–æv–g’‡°¢W6W&æÖS¢×6ræWF†÷#òçW6W&æÖRÇÂ6÷W&6UW6W$æÖRÀ¢W6W$–C¢×6ræWF†÷#òæ–BÇÂ×6ræWF†÷#òçW6W$–BÇÂVæFVf–æVBÀ¢F—7Æ”æÖS¢×6ræWF†÷#òæF—7Æ”æÖRÇÂ×6ræWF†÷#òævÆö&ÄæÖRÇÂ×6ræWF†÷#òævÆö&ÅöæÖRÇÂ6÷W&6UW6W$æÖRÀ¢wV–ÆD–C¢×6ræwV–ÆD–BÇÂ×6ræwV–ÆEö–BÇÂVæFVf–æVBÀ¢wV–ÆDæÖS¢×6ræwV–ÆCòææÖRÇÂ×6ræwV–ÆEöæÖRÇÂVæFVf–æVBÀ¢6†ææVÄ–C¢6÷W&6T6†ææVÄ–BÀ¢6†ææVÄæÖS¢×6ræ6†ææVÃòææÖRÇÂ×6ræ6†ææVÅöæÖRÇÂVæFVf–æVBÀ¢6†ææVÅG—S¢×6ræ6†ææVÃòçG—RÇÂ×6ræ6†ææVÅG—RÇÂ×6ræ6†ææVÅ÷G—RÇÂVæFVf–æVBÀ¢ÖW76vT–C¢×6ræ–BÇÂ×6ræÖW76vT–BÇÂ×6ræÖW76vUö–BÇÂVæFVf–æVBÀ¢7&VFVDC¢×6rçF–ÖW7F×ÇÂ×6ræ7&VFVDBÇÂ×6ræ7&VFVEöBÇÂVæFVf–æVBÀ¢—4F—&V7DÖW76vS¢&ööÆVâ†×6ræ—4DÒÇÂ×6ræ—4F—&V7DÖW76vRÇÂ×6ræ—5öF—&V7EöÖW76vR’À¢ÖW76vS¢FV6—6–öâç&ö×D–ç7G'V7F–öâÀ¢FVæçD–C¢FVæçD–BÇÂVæFVf–æVBÀ¢6öçFW‡C¢vF—66÷&BrÀ¢Ò¢Ò“° ¢–b‡&W7öç6Ræö²’°¢6öç7BFFÒv—B&W7öç6Ræ§6öâ‚“°¢6öç7B•&WÇ’ÒFFç&W7öç6SòçG&–Ò‚’ÇÂFFæFFòç&W7öç6SòçG&–Ò‚’ÇÂrs°¢–b†•&WÇ’’°¢v—B6VæDF—66÷&DÖW76vR‡6÷W&6T6†ææVÄ–BÂ•&WÇ’’æ6F6‚‚†W'&÷"’Óâ6öç6öÆRæW'&÷"‚u´F—66÷&B'&–FvUÒf–ÆVBFò6VæB7&÷72Ö&÷B&WÇ“¢rÂW'&÷"’“°¢–b‡FVæçD–B’°¢v—BVæD&÷D–çFW&7F–öâ‡°¢ÆFf÷&Ó¢vF—66÷&BrÀ¢FVæçD–BÀ¢6†ææVÄ–C¢6÷W&6T6†ææVÄ–BÀ¢6÷W&6UW6W#¢6÷W&6UW6W$æÖRÀ¢7V¶W$&÷D–C¢FV6—6–öâç7V¶W"ç7F&ÆT–BÀ¢7V¶W$&÷DæÖS¢FV6—6–öâç7V¶W"æ7W'&VçDæÖRÀ¢F&vWD&÷D–G3¢FV6—6–öâçF&vWG2æÖ‚‡F&vWC¢ç’’ÓâF&vWBç7F&ÆT–B’À¢F&vWD&÷DæÖW3¢FV6—6–öâçF&vWG2æÖ‚‡F&vWC¢ç’’ÓâF&vWBæ7W'&VçDæÖR’À¢G&–vvW$ÖW76vS¢×6ræ6öçFVçBÀ¢&W7öç6TÖW76vS¢•&WÇ’À¢Ò’æ6F6‚‚‚’Óâ·Ò“°¢Ğ¢&WGW&â²6öÖÖæD†æFÆVC¢fÇ6RÓ°¢Ğ¢ÒVÇ6R°¢6öç6öÆRæW'&÷"‚u´F—66÷&B'&–FvUÒ7&÷72Ö&÷B’f–ÆVC¢rÂ&W7öç6Rç7FGW2Âv—B&W7öç6RçFW‡B‚’æ6F6‚‚‚’Óârr’“°¢Ğ¢Ğ¢Ò6F6‚†W'&÷"’°¢6öç6öÆRæW'&÷"‚u´F—66÷&B'&–FvUÒ7&÷72Ö&÷B†æFÆ–ærf–ÆVC¢rÂW'&÷"“°¢Ğ¢Ğ¢ ¢–b‚÷F–öç2ç6¶—Gv—F6„'&–FvR’°¢v—B'&–FvTF—66÷&DÖW76vUFõGv—F6‚‡°¢ââæ×6rÀ¢6†ææVÄ–C¢6÷W&6T6†ææVÄ–BÀ¢ÒÂFVæçD–B“°¢Ğ ¢–b‚×6ræWF†÷#òæ&÷Bbbæ÷&ÖÆ—¦VD6öçFVçBbbæ÷&ÖÆ—¦VD6öçFVçBç7F'G5v—F‚‚rr’bbæ÷&ÖÆ—¦VD6öçFVçBç7F'G5v—F‚‚u²r’’°¢6öç7B6”ÖW76vRÒ6ÆVå6•FW‡Df÷%7VV6‚†æ÷&ÖÆ—¦VD6öçFVçB“°¢–b†—56•FW‡E7V¶&ÆR‡6”ÖW76vR’’°¢&VE6•W6W'2‚’çF†Vâ‚‡6•W6W'2’Óâ°¢6öç7BW6W$–BÒ×6ræWF†÷#òæ–BÇÂ×6rçW6W$–BÇÂ6÷W&6UW6W$æÖS°¢–b‚—56”Væ&ÆVB‡6•W6W'2ÂW6W$–BÂ6÷W&6T6†ææVÄ–B’’&WGW&ã°¢6öç7B6”6†ææVÄ¶W’Ò&W6öÇfU6•7G&VÔ¶W’‡VæFVf–æVBÂvF—66÷&BrÂ6÷W&6T6†ææVÄ–B“°¢–b†—56•7W&W76VDf÷%FVæçB‡6”6†ææVÄ¶W’’’&WGW&ã°¢6öç7B7ö¶VäÖW76vRÒf÷&ÖE6•7VV6…FW‡B‡6”6†ææVÄ¶W’Â6÷W&6UW6W$æÖRÂ6”ÖW76vR“°¢&WGW&âfWF6‚†G¶vWD–çFW&æÄW&Â‚—Òö’÷6’÷VWVVÂ°¢ÖWF†öC¢uõ5BrÀ¢†VFW'3¢²t6öçFVçBÕG—Rs¢vÆ–6F–öâö§6öârÒÀ¢&öG“¢¥4ôâç7G&–æv–g’‡²FVæçD–C¢6”6†ææVÄ¶W’ÂFW‡C¢7ö¶VäÖW76vRÒ’À¢Ò“°¢Ò’æ6F6‚‚†W'&÷"’Óâ6öç6öÆRçv&â‚uµ6’EE5ÒF—66÷&BVWVRf–ÆVC¢rÂW'&÷"’“°¢Ğ¢Ğ ¢&WGW&â²6öÖÖæD†æFÆVC¢fÇ6RÓ°§Ğ 