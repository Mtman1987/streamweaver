import { getAllCommands } from '../lib/commands-store';
import { getActionById, getAllActions } from '../lib/actions-store';
import { runFlowGraph, defaultFlowServices } from '../lib/flow-runtime';
import { sendDiscordMessage } from './discord';
import { sendChatMessage } from './twitch';
import { getKickService } from './kick';
import { addPoints, awardChatPoints, formatCompactPointAmount } from './points';
import { givePoints, stealPoints } from './points-transfer';
import { getWelcomeEligibility, markUserWelcomed, getWelcomeMode } from './welcome-wagon';
import { handleWalkOnShoutout } from './walk-on-shoutout';
import { handleVoiceShoutout } from './voice-shoutout';
import { auditError, recordShoutoutAudit } from './shoutout-audit';
import { autoTranslateIncoming, isTranslationActive, handleOneOffTranslation } from './translation-manager';
import { handleLeaderboardCommand } from './leaderboard-commands';
import { startBRB, stopBRB, toggleClipMode, getClipMode } from './brb-clips';
import { handleGamble as handleClassicGamble, handleRoll, handleDouble } from './gamble/classic-gamble';
import { getPoints, getPointBalance, setPoints } from './points';
import { getAIConfig } from './ai-provider';
import { getTenantIdFromChannel } from './twitch-client';
import { incrementMetric } from './metrics';
import { isKnownBot } from './known-bots';
import { ATHENA_WHITELIST_TENANT_ID } from './athena-whitelist';
import { readWorldLore, type WorldLoreCharacter } from '../lib/world-lore-store';
import { handleKickMessage as dispatchKickMessage } from './kick-dispatcher';
import { SubActionType, TriggerType } from './automation/types';
import type { KickMessage } from './kick';
import * as fs from 'fs/promises';
import { resolve } from 'path';
import { globalPath, tenantPath } from '../lib/tenant';
import { recordDashboardActivity } from '../lib/dashboard-activity-store';
import { appendPublicChatMessages } from '../lib/public-chat-store';
import type { StorageContext } from './storage';

type DiscordDispatchOptions = {
    skipPublicHistory?: boolean;
    skipAiMentions?: boolean;
    skipTwitchBridge?: boolean;
};

async function bridgeDiscordMessageToTwitch(msg: any, tenantId?: string) {
    if (String(msg.content || '').startsWith('[')) return;

    let processedContent = String(msg.content || '');

    if (msg.mentions && msg.mentions.users) {
        for (const [userId, user] of msg.mentions.users) {
            processedContent = processedContent.replace(new RegExp(`<@!?${userId}>`, 'g'), `@${user.username}`);
        }
    }

    processedContent = processedContent.replace(/<:(\w+):(\d+)>/g, ':$1:');

    const sourceUserName = msg.author?.username || msg.author?.globalName || msg.author?.global_name || 'Discord User';
    const twitchMessage = `[Discord] ${sourceUserName}: ${processedContent}`;
    await sendChatMessage(twitchMessage, 'bot', undefined, tenantId).catch(e => console.error('[Bridge] Failed:', e));
}

async function executeDiscordCommandMessage(msg: any, tenantId?: string): Promise<boolean> {
    const content = String(msg.content || '').trim();
    if (!content.startsWith('!')) return false;

    const sourceChannelId = msg.channelId || msg.channel_id;
    if (!sourceChannelId) return false;

    const sourceUserName = msg.author?.username || msg.author?.globalName || msg.author?.global_name || 'Discord User';
    const actualUsername = sourceUserName.replace(/^@/, '').trim() || 'DiscordUser';
    const actualMessage = content;
    const cmdName = actualMessage.slice(1).split(/\s+/)[0]?.toLowerCase() || '';
    if (!cmdName) return false;

    const tenantCtx: StorageContext | undefined = tenantId ? { tenantId, username: actualUsername } : undefined;
    const reply = (message: string) => sendDiscordMessage(sourceChannelId, message).catch(() => {});

    if (actualMessage.toLowerCase() === '!points') {
        try {
            const userPoints = await getPoints(actualUsername, tenantCtx);
            await reply(`@${actualUsername} has ${userPoints.pointsDisplay} points!`);
        } catch (error) {
            console.error('[Discord Dispatcher] Points fetch failed:', error);
            await reply(`@${actualUsername}, couldn't fetch your points!`);
        }
        return true;
    }

    if (actualMessage.toLowerCase() === '!coinflip') {
        const result = Math.random() < 0.5 ? 'Heads' : 'Tails';
        await reply(`@${actualUsername} flipped a coin: ${result}! 🪙`);
        return true;
    }

    if (actualMessage.toLowerCase() === '!time') {
        const now = new Date();
        const pst = now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles', hour: '2-digit', minute: '2-digit' });
        const mst = now.toLocaleString('en-US', { timeZone: 'America/Denver', hour: '2-digit', minute: '2-digit' });
        const cst = now.toLocaleString('en-US', { timeZone: 'America/Chicago', hour: '2-digit', minute: '2-digit' });
        const est = now.toLocaleString('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit' });
        const utc = now.toLocaleString('en-US', { timeZone: 'UTC', hour: '2-digit', minute: '2-digit' });

        await reply(`🕐 PST: ${pst} | MST: ${mst} | CST: ${cst} | EST: ${est} | UTC: ${utc}`);
        return true;
    }

    const commands = await getAllCommands(tenantId);
    const configuredCommand = commands.find((c: any) => String(c.command || '').toLowerCase().replace(/^!/, '') === cmdName);
    const command = configuredCommand || commands.find((c: any) => String(c.command || '').toLowerCase().replace(/^!/, '') === cmdName && c.enabled);

    if (!command) return false;

    const cmdArgs = actualMessage.substring(cmdName.length + 2).trim().split(/\s+/).filter(Boolean);
    const targetRaw = cmdArgs[0]?.replace('@', '') || '';
    const execArgs: Record<string, any> = {};
    cmdArgs.forEach((arg: string, index: number) => {
        execArgs[`input${index}`] = arg;
    });
    execArgs.rawInput = cmdArgs.join(' ');
    execArgs.tenantId = tenantId || '';

    const executionContext = {
        user: actualUsername,
        userName: actualUsername,
        message: actualMessage,
        rawInput: cmdArgs.join(' '),
        platform: 'discord',
        channel: sourceChannelId,
        tenantId: tenantId || undefined,
        args: execArgs,
        variables: {
            user: actualUsername,
            userName: actualUsername,
            channel: sourceChannelId,
            discordChannelId: sourceChannelId,
            tenantId: tenantId || '',
            targetUser: targetRaw,
            targetUserName: targetRaw,
            rawInput: cmdArgs.join(' '),
        },
    };

    const actionsForCommand = (await getAllActions(tenantId)).filter((action: any) =>
        action?.enabled &&
        Array.isArray(action.triggers) &&
        action.triggers.some((trigger: any) =>
            trigger?.enabled !== false &&
            Number(trigger?.type) === 401 &&
            String(trigger?.commandId || '') === String((command as any).id || '')
        )
    );

    if (actionsForCommand.length > 0) {
        const { SubActionExecutor } = await import('./automation/SubActionExecutor');
        const executor = new SubActionExecutor();
        for (const action of actionsForCommand) {
            console.log(`[Discord Dispatcher] Executing command-triggered action ${action.id} for ${cmdName}`);
            await executor.executeAction(action, executionContext);
        }
        return true;
    }

    if ((command as any).response && !(command as any).actionId && !(command as any).actions) {
        await reply((command as any).response);
        return true;
    }

    if (!(command as any).actionId) {
        const socialCommands: Record<string, string> = {
            'hug': '{user} wraps {target} in the cosmic warmth of love and understanding 🤗',
            'boop': '{user} boops {target} on the nose! *boop* 👉',
            'cuddle': '{user} cuddles up with {target} in a cozy embrace 🥰',
            'dance': '{user} breaks out into a dance with {target}! 💃🕺',
            'fistbump': '{user} gives {target} an epic fist bump! 👊',
            'headpat': '{user} gently pats {target} on the head *pat pat* 🤚',
            'highfive': '{user} high-fives {target}! ✋',
            'love': '{user} sends love to {target}! ❤️',
            'tickle': '{user} tickles {target}! *giggle* 😆',
            'lurk': '{user} is lurking in the shadows 👀',
            'unlurk': '{user} emerges from the shadows! Welcome back! 👋',
            'hydrate': 'Time to hydrate! 💧 Stay healthy, chat!',
            'stretch': 'Stretch break! 🤸 Take care of your body!',
            'yes': 'Yes! ✅',
            'yup': 'Yup! 👍',
            'no': 'Nope! ❌',
            'hover': '{user} hovers mysteriously 🛸',
        };

        if (socialCommands[cmdName]) {
            const target = actualMessage.substring(cmdName.length + 2).trim() || 'someone';
            const response = socialCommands[cmdName]
                .replace('{user}', actualUsername)
                .replace('{target}', target);
            await reply(response);
            return true;
        }
    }

    if ((command as any).actionId) {
        const action = await getActionById((command as any).actionId, tenantId);
        if (action?.subActions?.length) {
            const { SubActionExecutor } = await import('./automation/SubActionExecutor');
            const executor = new SubActionExecutor();
            await executor.executeAction(action, executionContext);
            return true;
        }
    }

    return true;
}

const CORE_POKEMON_CONFIRMATION_COMMANDS = new Set(['accept', 'cancel', 'swap']);
const VERBOSE_LOGS = process.env.STREAMWEAVER_VERBOSE_LOGS === 'true';

// Track processed messages to prevent duplicates
const processedMessages = new Set<string>();

// Track messages that already have TTS (e.g. from shoutout flow) to prevent double TTS
const ttsHandledMessages = new Set<string>();

// Track auto welcome shoutouts already in flight so rapid first messages do not
// launch duplicate walk-ons while we wait for Twitch/AI/TTS work to finish.
const pendingWelcomeUsers = new Set<string>();

const LORE_BOT_USERNAME_CACHE_MS = 30_000;
let loreBotUsernameCache: { expiresAt: number; usernames: Set<string> } | null = null;

export function markTtsHandled(message: string) {
    ttsHandledMessages.add(message.slice(0, 100));
    // Auto-cleanup after 10 seconds
    setTimeout(() => ttsHandledMessages.delete(message.slice(0, 100)), 10000);
}

export async function handleKickMessage(message: KickMessage, tenantId: string) {
    return dispatchKickMessage(message, tenantId);
}

function normalizeBotHandle(value: string): string {
    return value.toLowerCase().replace(/^@/, '').trim();
}

function loreCharacterNames(character: WorldLoreCharacter): string[] {
    return [
        character.currentName,
        ...(character.aliases || []),
        ...(character.previousNames || []),
    ].filter(Boolean);
}

async function isLoreBotUsername(username: string): Promise<boolean> {
    const normalized = normalizeBotHandle(username);
    if (!normalized) return false;

    try {
        const now = Date.now();
        if (!loreBotUsernameCache || loreBotUsernameCache.expiresAt <= now) {
            const lore = await readWorldLore();
            const usernames = new Set<string>();
            for (const character of Object.values(lore?.characters || {})) {
                for (const name of loreCharacterNames(character)) {
                    usernames.add(normalizeBotHandle(name));
                }
            }
            loreBotUsernameCache = {
                expiresAt: now + LORE_BOT_USERNAME_CACHE_MS,
                usernames,
            };
        }
        return loreBotUsernameCache.usernames.has(normalized);
    } catch {
        return false;
    }
}

function pickCrossBotReplyLimit(): number {
    const weightedLimits = [1, 2, 2, 3, 3];
    return weightedLimits[Math.floor(Math.random() * weightedLimits.length)] || 2;
}

function randomCrossBotDelayMs(): number {
    return 10_000 + Math.floor(Math.random() * 5_001);
}

function delay(ms: number): Promise<void> {
    return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

// Pagination state for card listings
const cardListings = new Map<string, { cards: string[], page: number }>();

async function sendTwitchCrossBotFollowUp(input: {
    channel: string;
    userName: string;
    triggerMessage: string;
    speakerName: string;
    speakerStableId?: string;
    speakerTenantId?: string;
    speakerReply: string;
    targets?: any[];
}) {
    try {
        const { getBotShareMode, appendBotInteraction } = await import('../lib/bot-interactions-store');
        if (await getBotShareMode(input.speakerTenantId) !== 'on') return;

        if (await isKnownBot(input.userName.toLowerCase(), input.speakerTenantId)) return;

        const { isBotTriggerIgnored } = require('../lib/bot-trigger-ignore-store');
        const speakerId = input.speakerStableId || '';
        const seedTargets = Array.isArray(input.targets) ? input.targets : [];
        if (!seedTargets.length) return;

        const tenantFromStableId = (stableId: string): string | undefined => {
            const [prefix] = stableId.split(':');
            if (!prefix || prefix === 'unknown' || prefix === 'discordUserId' || prefix === 'twitchUserId') return undefined;
            return prefix;
        };

        const initialTargets: any[] = [];
        for (const t of seedTargets) {
            if (speakerId && t.stableId === speakerId) continue;
            if (!(await isBotTriggerIgnored({ tenantId: tenantFromStableId(t.stableId), stableId: t.stableId, botName: t.currentName }, input.speakerTenantId))) {
                initialTargets.push(t);
            }
        }
        if (!initialTargets.length) return;

        const responded = new Set<string>();
        const queue = [...initialTargets];
        const replyLimit = pickCrossBotReplyLimit();
        let count = 0;
        let lastSpeakerName = input.speakerName;
        let lastSpeakerId = speakerId;
        let lastReply = input.speakerReply;

        while (queue.length > 0 && count < replyLimit) {
            const target: any = queue.shift();
            if (responded.has(target.stableId)) continue;
            responded.add(target.stableId);

            const targetTenantId = await resolveTenantForLoreBot(target, input.speakerTenantId);
            const targetPersonality = [
                `You are ${target.currentName}.`,
                target.archetype ? `Archetype: ${target.archetype}.` : '',
                target.summary || '',
                target.personalityNotes?.length ? target.personalityNotes.join(' ') : '',
                'Stay in this bot identity for this single Twitch follow-up.',
            ].filter(Boolean).join('\n');
            const prompt = [
                'Cross-bot follow-up on Twitch.',
                `${lastSpeakerName} replied: "${lastReply}"`,
                `${input.userName} originally asked: "${input.triggerMessage}"`,
                'Answer as yourself in 1 short Twitch-friendly sentence. Do not impersonate the other bot. Do not keep the chain going.',
            ].join('\n');

            const response = await fetch(`http://127.0.0.1:${process.env.PORT||3100}/api/ai/chat-with-memory`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    username: input.userName,
                    message: prompt,
                    personality: targetPersonality,
                    responseName: target.currentName,
                    tenantId: targetTenantId,
                    context: 'twitch-cross-bot',
                }),
            });
            if (!response.ok) {
                console.error('[Dispatcher] Twitch cross-bot AI failed:', response.status, await response.text().catch(() => ''));
                continue;
            }

            const data = await response.json();
            const reply = data.response?.trim() || data.data?.response?.trim() || '';
            if (!reply) continue;

            const waitMs = randomCrossBotDelayMs();
            console.log(`[Dispatcher] Waiting ${Math.round(waitMs / 1000)}s before ${target.currentName} cross-bot follow-up (${count + 1}/${replyLimit})`);
            await delay(waitMs);

            await sendChatMessage(reply, 'bot', input.channel, targetTenantId).catch((error) => {
                console.error('[Dispatcher] Twitch cross-bot send failed:', error);
            });
            await appendBotInteraction({
                platform: 'twitch',
                tenantId: targetTenantId,
                channelId: input.channel,
                sourceUser: input.userName,
                speakerBotId: target.stableId,
                speakerBotName: target.currentName,
                targetBotIds: lastSpeakerId ? [lastSpeakerId] : [],
                targetBotNames: [lastSpeakerName],
                triggerMessage: input.triggerMessage,
                responseMessage: reply,
            }).catch(() => {});
            count++;
            lastSpeakerId = target.stableId;
            lastSpeakerName = target.currentName;
            lastReply = reply;
        }
    } catch (error) {
        console.error('[Dispatcher] Twitch cross-bot follow-up failed:', error);
    }
}

async function getDiscordLogChannelId(tenantId?: string): Promise<string | null> {
    try {
        const p = tenantId
            ? tenantPath(tenantId, 'tokens/discord-channels.json')
            : resolve(process.cwd(), 'tokens', 'discord-channels.json');
        const data = await fs.readFile(p, 'utf-8');
        const config = JSON.parse(data);
        if (config.discordBridgeEnabled === false) return null;
        return config.logChannelId;
    } catch { return null; }
}

const ATHENA_STABLE_ID = `${ATHENA_WHITELIST_TENANT_ID}:athena`;

async function getAthenaEverywhereMode(): Promise<'on' | 'off'> {
    if (process.env.ATHENA_EVERYWHERE_MODE === 'false') return 'off';
    try {
        const raw = await fs.readFile(globalPath('athena-everywhere-mode.json'), 'utf-8');
        const parsed = JSON.parse(raw);
        return parsed.mode === 'off' ? 'off' : 'on';
    } catch {
        return 'on';
    }
}

async function setAthenaEverywhereMode(mode: 'on' | 'off'): Promise<'on' | 'off'> {
    const filePath = globalPath('athena-everywhere-mode.json');
    await fs.mkdir(resolve(filePath, '..'), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify({ mode }, null, 2));
    return mode;
}

async function toggleAthenaEverywhereMode(): Promise<'on' | 'off'> {
    const current = await getAthenaEverywhereMode();
    return setAthenaEverywhereMode(current === 'on' ? 'off' : 'on');
}

async function canRouteAthenaForUser(input: {
    username: string;
    tenantId?: string;
}): Promise<boolean> {
    try {
        const { canUseAthenaEverywhere } = await import('./athena-whitelist');
        return canUseAthenaEverywhere(input);
    } catch (error) {
        console.error('[Dispatcher] Athena whitelist check failed:', error);
        return false;
    }
}

async function getFirstMentionedLoreBot(message: string) {
    const lower = message.toLowerCase();
    const athenaIndex = firstNameIndex(lower, ['athena', 'athenabot87']);
    try {
        const { readWorldLore } = await import('../lib/world-lore-store');
        const { firstMentionedCharacter } = await import('../lib/bot-interactions-store');
        const lore = await readWorldLore();
        const characters = Object.values(lore?.characters || {});
        const first = firstMentionedCharacter(message, characters);
        if (athenaIndex >= 0) {
            const firstIndex = first ? firstNameIndex(lower, [
                first.currentName,
                ...(first.aliases || []),
                ...(first.previousNames || []),
            ]) : -1;
            if (firstIndex < 0 || athenaIndex <= firstIndex) {
                return {
                    stableId: ATHENA_STABLE_ID,
                    currentName: 'Athena',
                    aliases: ['Athena', 'Athenabot87'],
                };
            }
        }
        return first;
    } catch {
        if (athenaIndex >= 0) {
            return {
                stableId: ATHENA_STABLE_ID,
                currentName: 'Athena',
                aliases: ['Athena', 'Athenabot87'],
            };
        }
        return null;
    }
}

function firstNameIndex(messageLower: string, names: string[]): number {
    let best = -1;
    for (const rawName of names) {
        const name = String(rawName || '').toLowerCase().replace(/^@/, '').trim();
        if (!name) continue;
        const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const match = new RegExp(`(^|[^a-z0-9_])@?${escaped}([^a-z0-9_]|$)`, 'i').exec(messageLower);
        if (!match) continue;
        if (best < 0 || match.index < best) best = match.index;
    }
    return best;
}

async function resolveTenantForLoreBot(character: any, fallbackTenantId?: string): Promise<string | undefined> {
    const stableId = String(character?.stableId || '');
    const [stableTenant] = stableId.split(':');
    if (stableTenant && stableTenant !== 'unknown' && stableTenant !== 'discordUserId' && stableTenant !== 'twitchUserId') {
        return stableTenant;
    }

    try {
        const { listTenants } = await import('../lib/tenant');
        const { getBotName, getBotAliases } = await import('../lib/bot-settings-store');
        const names = [
            character?.currentName,
            ...(character?.aliases || []),
            ...(character?.previousNames || []),
        ].filter(Boolean).map((value: string) => value.toLowerCase());

        for (const tid of await listTenants()) {
            const botName = getBotName(tid).toLowerCase();
            const aliases = String(getBotAliases(tid) || '').toLowerCase().split(',').map((v) => v.trim());
            if (names.includes(botName) || aliases.some((alias) => alias && names.includes(alias))) {
                return tid;
            }
        }
    } catch {}

    return fallbackTenantId;
}

function getLoreCharacterFirstIndex(message: string, character: WorldLoreCharacter | null | undefined): number {
    if (!character) return -1;
    return firstNameIndex(message.toLowerCase(), [
        character.currentName,
        ...(character.aliases || []),
        ...(character.previousNames || []),
    ]);
}

async function getLoreCharacterForTenant(tenantId?: string): Promise<WorldLoreCharacter | null> {
    if (!tenantId) return null;
    try {
        const { getBotName, getBotAliases } = await import('../lib/bot-settings-store');
        const lore = await readWorldLore();
        const characters = Object.values(lore?.characters || {});
        const names = new Set([
            getBotName(tenantId),
            ...String(getBotAliases(tenantId) || '').split(',').map((value) => value.trim()),
        ].map((value) => normalizeBotHandle(value)).filter(Boolean));
        return characters.find((character) =>
            loreCharacterNames(character).some((name) => names.has(normalizeBotHandle(name)))
        ) || null;
    } catch {
        return null;
    }
}

async function getExplicitTwitchBotMentions(message: string): Promise<Array<{
    index: number;
    trigger: string;
    tenantId?: string;
    character: WorldLoreCharacter;
}>> {
    const matches = Array.from(message.toLowerCase().matchAll(/(^|[^a-z0-9_])@([a-z0-9_]+)/gi));
    if (!matches.length) return [];

    try {
        const handles = new Map<string, number>();
        for (const match of matches) {
            const handle = normalizeBotHandle(match[2] || '');
            if (!handle) continue;
            const index = typeof match.index === 'number' ? match.index : message.toLowerCase().indexOf(`@${handle}`);
            const existing = handles.get(handle);
            if (existing === undefined || index < existing) {
                handles.set(handle, index);
            }
        }
        if (!handles.size) return [];

        const lore = await readWorldLore();
        const characters = Object.values(lore?.characters || {});
        const { listTenants } = await import('../lib/tenant');
        const { getStoredTokens } = await import('../lib/token-utils.server');
        const { getBotName, getBotAliases } = await import('../lib/bot-settings-store');
        const resolved: Array<{
            index: number;
            trigger: string;
            tenantId?: string;
            character: WorldLoreCharacter;
        }> = [];

        for (const tid of await listTenants()) {
            const tokens = await getStoredTokens(tid);
            const botUsername = normalizeBotHandle(tokens?.botUsername || '');
            if (!botUsername || !handles.has(botUsername)) continue;

            const configuredName = getBotName(tid).trim() || tokens?.botUsername || botUsername;
            const configuredAliases = String(getBotAliases(tid) || '')
                .split(',')
                .map((value) => value.trim())
                .filter(Boolean);
            const candidateNames = new Set([
                configuredName,
                tokens?.botUsername || '',
                ...configuredAliases,
            ].map((value) => normalizeBotHandle(value)).filter(Boolean));
            const loreCharacter = characters.find((character) =>
                loreCharacterNames(character).some((name) => candidateNames.has(normalizeBotHandle(name)))
            );

            resolved.push({
                index: handles.get(botUsername) ?? 0,
                trigger: `@${botUsername}`,
                tenantId: tid,
                character: loreCharacter || {
                    stableId: `${tid}:bot`,
                    currentName: configuredName,
                    aliases: Array.from(new Set([tokens?.botUsername, ...configuredAliases].filter((value): value is string => Boolean(value)))),
                },
            });
        }

        return resolved.sort((a, b) => a.index - b.index || a.character.currentName.localeCompare(b.character.currentName));
    } catch (error) {
        console.error('[Dispatcher] Failed to resolve explicit Twitch bot mentions:', error);
        return [];
    }
}

export async function handleTwitchMessage(channel: string, tags: any, message: string, self: boolean) {
    const username = tags.username!;
    const displayName = tags['display-name'] || username;
    const replyChannel = channel.replace(/^#/, '');
    
    // Resolve tenant from channel
    let tenantId = getTenantIdFromChannel(replyChannel);
    
    // Fallback: resolve tenant from username if channel didn't map
    if (!tenantId) {
        try {
            const { getActiveTenantIds, getTenantIdFromChannel: getTid } = require('./twitch-client');
            const { getStoredTokens: gst } = require('../lib/token-utils.server');
            for (const tid of getActiveTenantIds()) {
                const tokens = await gst(tid);
                if (tokens?.broadcasterUsername?.toLowerCase() === replyChannel.toLowerCase()) { tenantId = tid; break; }
            }
        } catch {}
    }
    
    // Build storage context for tenant-scoped services
    const tenantCtx: StorageContext | undefined = tenantId ? { tenantId, username: replyChannel } : undefined;
    
    // Helper: send chat message to Twitch (shared-chat aware)
    const reply = (msg: string, as: 'bot' | 'broadcaster' = 'broadcaster') => sendChatMessage(msg, as, replyChannel, tenantId);

    // Mirror Twitch dispatcher outputs to Kick for duel-stream mode.
    // Enable with: KICK_MIRROR_CHAT=true

    // Notes:
    // - We always send the same text to Kick; Kick handles the formatting internally.
    // - Some features (like points/storage) are handled independently on Kick; mirroring is for outputs/replies only.

    const shouldMirrorToKick = () => {
        // Enable with: KICK_MIRROR_CHAT=true
        return process.env.KICK_MIRROR_CHAT === 'true';
    };

    const replyToKick = async (msg: string) => {
        try {
            const kick = getKickService(tenantId);
            if (!kick.isConnected()) return;
            await kick.sendChatMessage(msg);
        } catch {}
    };

    const replyToKickIfEnabled = async (msg: string) => {
        if (!shouldMirrorToKick()) return;
        await replyToKick(msg);
    };

    const runChatAutomationTriggers = async (): Promise<boolean> => {
        if (self || isBotMessage || !actualMessage || actualMessage.startsWith('!')) return false;

        const actions = await getAllActions(tenantId);
        const matchingActions = actions.filter((action: any) =>
            action?.enabled &&
            Array.isArray(action.triggers) &&
            action.triggers.some((trigger: any) => {
                if (trigger?.enabled === false) return false;
                if (Number(trigger?.type) !== TriggerType.CHAT_MESSAGE) return false;
                if (trigger?.excludeBots !== false && isBotMessage) return false;
                const pattern = String(trigger?.pattern || '').trim();
                if (!pattern) return true;
                try {
                    return new RegExp(pattern, 'i').test(actualMessage);
                } catch {
                    return false;
                }
            })
        );

        if (matchingActions.length === 0) return false;

        const { SubActionExecutor } = await import('./automation/SubActionExecutor');
        const executor = new SubActionExecutor();
        const executionContext = {
            user: actualUsername,
            userName: actualUsername,
            message: actualMessage,
            rawInput: actualMessage,
            platform: 'twitch',
            channel: replyChannel,
            tenantId: tenantId || undefined,
            args: {
                user: actualUsername,
                userName: actualUsername,
                message: actualMessage,
                channel: replyChannel,
                tenantId: tenantId || '',
                rawInput: actualMessage,
            },
            variables: {
                user: actualUsername,
                userName: actualUsername,
                message: actualMessage,
                channel: replyChannel,
                tenantId: tenantId || '',
                rawInput: actualMessage,
                platform: 'twitch',
            },
            actionStack: [],
        };

        for (const action of matchingActions) {
            console.log(`[Dispatcher] Executing chat-triggered action ${action.id} for message "${actualMessage}"`);
            await executor.executeAction(action, executionContext);
        }

        return matchingActions.some((action: any) =>
            !Array.isArray(action.subActions) ||
            action.subActions.some((subAction: any) => Number(subAction?.type) !== SubActionType.VOICE_REPLY_PROMPT)
        );
    };

    const replyMaybeKick = async (msg: string, as: 'bot' | 'broadcaster' = 'broadcaster') => {
        await reply(msg, as).catch(() => {});
        await replyToKickIfEnabled(msg);
    };



    
    // Prevent duplicate processing with more specific ID
    const messageId = `${tags.id || 'no-id'}-${username}-${message.slice(0, 50)}`;
    
    if (processedMessages.has(messageId)) {
        console.log(`[Dispatcher] Skipping duplicate message: ${messageId}`);
        return;
    }
    processedMessages.add(messageId);
    
    // Also check for recent identical messages
    const contentKey = `${username}-${message}`;
    const now = Date.now();
    const recentMessages = (global as any).recentMessages || new Map();
    
    if (recentMessages.has(contentKey)) {
        const lastTime = recentMessages.get(contentKey);
        if (now - lastTime < 5000) { // 5 second window
            console.log(`[Dispatcher] Skipping recent duplicate content from ${username}`);
            return;
        }
    }
    recentMessages.set(contentKey, now);
    (global as any).recentMessages = recentMessages;
    
    // Clean up old recent messages to prevent memory leak
    if (recentMessages.size > 500) {
        const entries = Array.from(recentMessages.entries()) as [string, number][];
        entries.sort((a, b) => a[1] - b[1]);
        for (let i = 0; i < entries.length - 200; i++) {
            recentMessages.delete(entries[i][0]);
        }
    }
    
    // Clean up old message IDs (keep last 100)
    if (processedMessages.size > 100) {
        const oldIds = Array.from(processedMessages).slice(0, processedMessages.size - 100);
        oldIds.forEach(id => processedMessages.delete(id));
    }
    
    // Track chat messages for redemptions (before any other processing)
    let consumedByRedemption = false;
    if (!self && !message.startsWith('!') && !message.startsWith('[')) {
        const { trackChatMessageForRedemption } = require('./eventsub');
        consumedByRedemption = trackChatMessageForRedemption(username, message, tenantId);
    }
    
    // Extract actual message if it came from Discord
    let actualMessage = message;
    let actualUsername = username;
    if (message.startsWith('[Discord] ')) {
        const match = message.match(/^\[Discord\]\s+([^:]+):\s+(.+)$/);
        if (match) {
            actualUsername = match[1].trim();
            actualMessage = match[2];
            console.log(`[Dispatcher] Extracted Discord message - user: ${actualUsername}, message: ${actualMessage}`);
        } else {
            console.log(`[Dispatcher] Failed to parse Discord message: ${message}`);
        }
    }
    
    const isCommand = actualMessage.startsWith('!');
    
    // Get usernames from stored tokens (OAuth source of truth), then user config as fallback
    let botUsername = 'streamweaverbot';
    let broadcasterUsername = 'broadcaster';
    try {
        const { readUserConfigSync } = require('../lib/user-config');
        const config = readUserConfigSync(tenantId);
        broadcasterUsername = config.TWITCH_BROADCASTER_USERNAME || 'broadcaster';
        botUsername = config.TWITCH_BOT_USERNAME || 'streamweaverbot';
    } catch {}
    try {
        const fsSync = require('fs');
        const path = require('path');
        const { tenantPath: tp } = require('../lib/tenant');
        const tokensPath = tenantId
            ? tp(tenantId, 'tokens/twitch-tokens.json')
            : path.join(process.cwd(), 'tokens', 'twitch-tokens.json');
        if (fsSync.existsSync(tokensPath)) {
            const tokens = JSON.parse(fsSync.readFileSync(tokensPath, 'utf8'));
            if (tokens.botUsername) botUsername = tokens.botUsername;
            if (tokens.broadcasterUsername) broadcasterUsername = tokens.broadcasterUsername;
        }
    } catch {}
    
    const isBot = actualUsername.toLowerCase() === (botUsername || '').toLowerCase();
    const isBotMessage = actualUsername.toLowerCase() === (botUsername || '').toLowerCase();
    const isKnownAutomationBotMessage = !isBotMessage && (
        await isKnownBot(actualUsername, tenantId) ||
        await isLoreBotUsername(actualUsername)
    );

    if (!self && !isBotMessage && !message.startsWith('[') && actualMessage.trim()) {
        appendPublicChatMessages([{
            type: 'user',
            username: actualUsername,
            message: actualMessage,
            timestamp: new Date().toISOString(),
        }], 300, tenantId).catch(() => {});
    }

    if (VERBOSE_LOGS) {
        console.log(`[Dispatcher] Handling Twitch message: "${message}" from ${displayName} (self: ${self}, isBot: ${isBot}, isBotMessage: ${isBotMessage}, isKnownAutomationBotMessage: ${isKnownAutomationBotMessage})`);
    }
    
    // Skip self messages (broadcaster client echoes its own sends)
    if (self) return;

    recordDashboardActivity({
        id: String(tags.id || `twitch-${Date.now()}-${Math.random().toString(36).slice(2)}`),
        tenantId,
        platform: message.startsWith('[Discord] ') ? 'Discord' : 'Twitch',
        user: actualUsername,
        message: actualMessage,
        color: tags.color,
    });
    
    // Handle AI memory clear command FIRST (before any other processing)
    const aiConfig = getAIConfig(tenantId);
    const botName = aiConfig.botName || 'AI Bot';
    const memoryClearPattern = new RegExp(`${botName.toLowerCase()}.*yeah i said it now get over it`, 'i');
    
    if (memoryClearPattern.test(actualMessage.toLowerCase())) {
        console.log(`[Dispatcher] Memory clear command detected from ${actualUsername}`);
        try {
            const response = await fetch(`http://127.0.0.1:${process.env.PORT||3100}/api/ai/clear-memory`, {
                method: 'POST'
            });
            
            if (response.ok) {
                await replyMaybeKick('ok but only because i want too, not because you told me', 'bot').catch(() => {});

                console.log(`[Dispatcher] AI memory cleared by ${actualUsername}`);
            } else {
                console.error('[Dispatcher] Memory clear API failed:', response.status);
            }
        } catch (error) {
            console.error('[Dispatcher] Memory clear failed:', error);
        }
        return; // Exit early to prevent further processing
    }
    
    // Handle basic commands that should work regardless of bot status
    if (isCommand) {
        console.log(`[Dispatcher] Command detected: ${actualMessage} from ${actualUsername}`);
        incrementMetric('totalCommands').catch(() => {});
        
        const commands = await getAllCommands(tenantId);
        const cmdName = actualMessage.substring(1).split(' ')[0].toLowerCase();
        const configuredCommand = commands.find((c: any) => String(c.command || '').toLowerCase().replace(/^!/, '') === cmdName);
        if (configuredCommand && configuredCommand.enabled === false) {
            if (!CORE_POKEMON_CONFIRMATION_COMMANDS.has(cmdName)) {
                console.log(`[Dispatcher] Command ${cmdName} is disabled; skipping built-in and action handling.`);
                return;
            }
            console.log(`[Dispatcher] Command ${cmdName} is disabled as a custom command; continuing with core Pokemon handler.`);
        }

        // Handle check-in commands (process early)
        const lowerMessage = actualMessage.toLowerCase();
        const checkinCommandKinds: Array<{ triggers: string[]; kind: 'partner' | 'crew' | 'mod' | 'space-mountain' }> = [
            { triggers: ['!checkin', '!partner'], kind: 'partner' },
            { triggers: ['!crew', '!crewcheckin'], kind: 'crew' },
            { triggers: ['!mod', '!modcheckin'], kind: 'mod' },
            { triggers: ['!spacemountain', '!space', '!spacecheckin'], kind: 'space-mountain' },
        ];
        const matchedCheckin = checkinCommandKinds.find((entry) => entry.triggers.some((trigger) => lowerMessage.startsWith(trigger)));
        if (matchedCheckin) {
            console.log(`[Dispatcher] Processing ${matchedCheckin.kind} checkin command from ${actualUsername}`);
            const cmd = actualMessage.split(' ')[0];
            const numArg = actualMessage.substring(cmd.length).trim();
            
            try {
                const { getConfigSection } = require('../lib/local-config/service');
                const { getCheckinSource } = require('./checkin-sources');
                const { formatCheckinList, createPendingPayload, runCheckin, runBulkCheckin } = require('./checkin-flow');
                const redeemsConfig = await getConfigSection('redeems', tenantId);
                const checkinConfigMap: Record<string, any> = {
                    'partner': redeemsConfig.partnerCheckin,
                    'crew': redeemsConfig.crewCheckin,
                    'mod': redeemsConfig.modCheckin,
                    'space-mountain': redeemsConfig.spaceMountainCheckin,
                };
                const pointCost = Number(checkinConfigMap[matchedCheckin.kind]?.pointCost || 0);

                if (pointCost > 0) {
                    const pts = await getPoints(actualUsername, tenantCtx);
                        if (pts.points < pointCost) {
                            await replyMaybeKick(`@${actualUsername}, you need ${formatCompactPointAmount(pointCost)} points for this check-in! (You have ${pts.pointsDisplay})`, 'broadcaster').catch(() => {});
                            return;

                    }
                }

                const source = await getCheckinSource(matchedCheckin.kind, tenantId, actualUsername);
                console.log(`[Dispatcher] Found ${source.entries.length} ${matchedCheckin.kind} entries`);
                
                if (matchedCheckin.kind === 'space-mountain') {
                    await runBulkCheckin('space-mountain', actualUsername, pointCost, tenantId);
                    return;
                }

                if (source.entries.length === 0) {
                    await replyMaybeKick(`@${actualUsername}, no ${source.sourceLabel.toLowerCase()} found right now.`, 'broadcaster').catch(() => {});
                    return;
                }
                
                const listMessage = formatCheckinList(matchedCheckin.kind, source.entries);
                console.log(`[Dispatcher] Check-in list message:`, listMessage);
                    await replyMaybeKick(listMessage, 'broadcaster').catch(() => {});


                const selectionId = parseInt(numArg, 10);
                if (!selectionId || isNaN(selectionId) || selectionId < 1) {
                    console.log(`[Dispatcher] Invalid ${matchedCheckin.kind} ID: ${numArg}, waiting for valid selection`);
                    const { pendingCheckins } = require('./eventsub');
                    if (pendingCheckins) {
                        const tenantKey = tenantId || 'global';
                        let tenantSelections = pendingCheckins.get(tenantKey);
                        if (!tenantSelections) {
                            tenantSelections = new Map();
                            pendingCheckins.set(tenantKey, tenantSelections);
                        }
                        tenantSelections.set(actualUsername.toLowerCase(), { timestamp: Date.now(), kind: matchedCheckin.kind, pointCost });
                        if ((global as any).broadcast) {
                            (global as any).broadcast({ type: 'checkin-pending', payload: createPendingPayload(matchedCheckin.kind, actualUsername, source.sourceLabel) }, tenantId);
                        }
                    }
                    return;
                }

                console.log(`[Dispatcher] Processing ${matchedCheckin.kind} checkin ${selectionId} for ${actualUsername}`);
                await runCheckin(matchedCheckin.kind, actualUsername, selectionId, pointCost, tenantId);
            } catch (error) {
                console.error('[Dispatcher] Checkin command failed:', error);
                await reply(`@${actualUsername}, checkin system error! Contact a mod.`, 'broadcaster').catch(() => {});
            }
            return;
        }
        
        // Handle !pack command (most used command - process early)
        if (actualMessage.toLowerCase().startsWith('!pack')) {
            console.log(`[Dispatcher] Processing !pack command from ${actualUsername}`);
            const numArg = actualMessage.substring(5).trim();
            
            try {
                const { getConfigSection } = require('../lib/local-config/service');
                const redeemsConfig = await getConfigSection('redeems', tenantId);
                const pointCost = redeemsConfig.pokePack.pointCost;
                console.log(`[Dispatcher] Pack cost: ${pointCost} points`);

                if (pointCost > 0) {
                    const pts = await getPoints(actualUsername, tenantCtx);
                    if (pts.points < pointCost) {
                        await reply(`@${actualUsername}, you need ${formatCompactPointAmount(pointCost)} points to open a pack! (You have ${pts.pointsDisplay})`, 'broadcaster').catch(() => {});
                        return;
                    }
                }

                const { getEnabledSetMap, formatSetList } = require('./pokemon-packs');
                const enabledSets = redeemsConfig.pokePack.enabledSets || ['base1','base2','base3','base4','base5','gym1'];
                console.log(`[Dispatcher] !pack tenant=${tenantId || 'global'} channel=${replyChannel} enabledSetCount=${enabledSets.length}`, enabledSets);
                
                const setMap = getEnabledSetMap(enabledSets);
                const setCount = Object.keys(setMap).length;
                console.log(`[Dispatcher] Available sets:`, setCount, setMap);
                
                if (setCount === 0) {
                    await reply(`@${actualUsername}, no Pokemon packs are available! Contact a mod.`, 'broadcaster').catch(() => {});
                    return;
                }

                const setNumber = parseInt(numArg, 10);
                if (!setNumber || isNaN(setNumber) || setNumber < 1 || setNumber > setCount) {
                    console.log(`[Dispatcher] Invalid set number: ${numArg}, waiting for valid selection`);
                    const setListMessage = formatSetList(setMap);
                    console.log(`[Dispatcher] Set list message:`, setListMessage);
                    await reply(setListMessage, 'broadcaster').catch(() => {});
                    const { pendingPackRedeems } = require('./eventsub');
                    if (pendingPackRedeems) {
                        const tenantKey = tenantId || 'global';
                        let tenantPackRedeems = pendingPackRedeems.get(tenantKey);
                        if (!tenantPackRedeems) {
                            tenantPackRedeems = new Map();
                            pendingPackRedeems.set(tenantKey, tenantPackRedeems);
                        }
                        tenantPackRedeems.set(actualUsername.toLowerCase(), { timestamp: Date.now(), pointCost });
                    }
                    return;
                }

                console.log(`[Dispatcher] Opening pack ${setNumber} for ${actualUsername}`);
                const { handlePackOpenCmd } = require('./eventsub');
                await handlePackOpenCmd(actualUsername, setNumber, pointCost, tenantId);
            } catch (error) {
                console.error('[Dispatcher] !pack command failed:', error);
                await reply(`@${actualUsername}, pack system error! Contact a mod.`, 'broadcaster').catch(() => {});
            }
            return;
        }
        
        // Handle !points command (works for everyone)
        if (actualMessage.toLowerCase() === '!points') {
            try {
                // Use same tenant context as chat points awarding
                const userPoints = await getPoints(actualUsername, tenantCtx);
                await reply(`@${actualUsername} has ${userPoints.pointsDisplay} points!`, 'broadcaster').catch(() => {});
            } catch (error) {
                console.error('[Dispatcher] Points fetch failed:', error);
                await reply(`@${actualUsername}, couldn't fetch your points!`, 'broadcaster').catch(() => {});
            }
            return;
        }
        
        // Handle !coinflip command (works for everyone)
        if (actualMessage.toLowerCase() === '!coinflip') {
            const result = Math.random() < 0.5 ? 'Heads' : 'Tails';
            await reply(`@${actualUsername} flipped a coin: ${result}! 🪙`, 'broadcaster').catch(() => {});
            return;
        }
        
        // Handle !time command (works for everyone)
        if (actualMessage.toLowerCase() === '!time') {
            const now = new Date();
            const pst = now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles', hour: '2-digit', minute: '2-digit' });
            const mst = now.toLocaleString('en-US', { timeZone: 'America/Denver', hour: '2-digit', minute: '2-digit' });
            const cst = now.toLocaleString('en-US', { timeZone: 'America/Chicago', hour: '2-digit', minute: '2-digit' });
            const est = now.toLocaleString('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit' });
            const utc = now.toLocaleString('en-US', { timeZone: 'UTC', hour: '2-digit', minute: '2-digit' });
            
            await reply(
                `🕐 PST: ${pst} | MST: ${mst} | CST: ${cst} | EST: ${est} | UTC: ${utc}`,
                'broadcaster'
            ).catch(() => {});
            return;
        }
    }
    
    // Allow !t translation commands from broadcaster/mods before other checks
    if (isCommand && actualMessage.toLowerCase().startsWith('!t ')) {
        const args = actualMessage.substring(3).trim().split(/\s+/);
        const translated = await handleOneOffTranslation(args);
        if (translated) {
            await reply(translated, 'bot').catch(() => {});
        }
        return;
    }
    
    // Skip bot-authored chatter to prevent reply loops (but allow manual commands).
    if ((isBotMessage || isKnownAutomationBotMessage) && !actualMessage.startsWith('!')) {
        // TTS is already handled by the original sender (AI mention handler, walk-on shoutout, etc.)
        // Don't generate duplicate TTS or let cross-bot replies re-enter AI mention handling.
        if (isKnownAutomationBotMessage) {
            console.log(`[Dispatcher] Skipping bot-authored non-command message from ${actualUsername}`);
        }
        return;
    }
    
    // Skip auto-translation for messages that start with [ to prevent loops
    if (!self && !message.startsWith('[') && (isTranslationActive() || require('./translation-manager').isUserAutoTranslate(actualUsername))) {
        const translated = await autoTranslateIncoming(actualMessage, actualUsername);
        if (translated) {
            console.log(`[Dispatcher] Auto-translated incoming: ${translated}`);
            // Show translation in chat as bot to prevent loops
            await reply(`[${actualUsername}]: ${translated}`, 'bot').catch(() => {});
        }
    }
    
    // Bridge to Discord (skip if message came from Discord to avoid loop)
    if (!message.startsWith('[')) {
        const logChannelId = await getDiscordLogChannelId(tenantId);
        if (logChannelId) {
            if (VERBOSE_LOGS) console.log(`[Dispatcher] Bridging to Discord: ${message}`);
            await sendDiscordMessage(logChannelId, `**[Twitch] ${displayName}:** ${message}`).catch(() => {});
        } else {
            if (VERBOSE_LOGS) console.log(`[Dispatcher] Discord bridge disabled or no channel configured`);
        }
    } else {
        if (VERBOSE_LOGS) console.log(`[Dispatcher] Skipping Discord bridge for message starting with [`);
    }

    if (isCommand && !isBot) {
        console.log(`[Dispatcher] Processing command: ${actualMessage} from ${actualUsername}`);
        const cmdName = actualMessage.substring(1).split(' ')[0].toLowerCase();
        
        // Handle !collection command
        if (actualMessage.toLowerCase() === '!collection') {
            const { getUserCards } = require('./pokemon-collection');
            const { getUserCollection } = require('./pokemon-storage-discord');
            const cards = await getUserCards(actualUsername);
            if (cards.length === 0) {
                await reply(`@${actualUsername}, you don't have any cards yet! Use !pack to open packs.`, 'broadcaster').catch(() => {});
                return;
            }
            const rareCount = cards.filter((c: any) => c.rarity && c.rarity.includes('Rare')).length;

            // Generate Pokédex HTML and serve locally
            let pokedexUrl = '';
            try {
                const { generatePokedexHtml } = require('./pokedex-html');
                const fsSync = require('fs');
                const pathMod = require('path');
                const { getConfiguredAppUrl } = require('../lib/runtime-origin');
                const POKEDEX_DIR = pathMod.join(process.env.PERSIST_ROOT || pathMod.join(process.cwd(), 'data', 'runtime'), 'global', 'pokedex');
                fsSync.mkdirSync(POKEDEX_DIR, { recursive: true });

                const collection = await getUserCollection(actualUsername);
                const html = await generatePokedexHtml(actualUsername, cards, collection.packsOpened);
                const key = actualUsername.toLowerCase();
                fsSync.writeFileSync(pathMod.join(POKEDEX_DIR, `${key}.html`), html);

                const baseUrl = getConfiguredAppUrl();
                pokedexUrl = `${baseUrl}/api/pokedex?user=${encodeURIComponent(key)}`;
            } catch (e) {
                console.error('[Collection] Pokédex generation failed:', e);
            }

            const urlPart = pokedexUrl ? ` Pok\u00e9dex: ${pokedexUrl}` : '';
            await reply(`@${actualUsername} has ${cards.length} cards (${rareCount} rare).${urlPart} | !gymteam <set-num> <set-num> <set-num>`, 'broadcaster').catch(() => {});

            if (typeof (global as any).broadcast === 'function') {
                (global as any).broadcast({
                    type: 'pokemon-collection-show',
                    payload: { username: actualUsername, cards }
                }, tenantId);
            }
            return;
        }

        if (actualMessage.toLowerCase().startsWith('!shoutoutaudit')) {
            const requester = actualUsername.toLowerCase();
            const broadcaster = (broadcasterUsername || '').toLowerCase();
            const extraAllowed = String(process.env.SHOUTOUT_AUDIT_COMMAND_USERS || 'mtman1987')
                .split(',')
                .map((user) => user.trim().toLowerCase())
                .filter(Boolean);
            const allowed = tags.badges?.broadcaster || requester === broadcaster || extraAllowed.includes(requester);

            if (!allowed) {
                await reply(`@${actualUsername}, only the broadcaster can use that command.`, 'bot').catch(() => {});
                return;
            }

            const arg = actualMessage.substring('!shoutoutaudit'.length).trim().replace(/^@/, '');
            const { getConfiguredAppUrl } = require('../lib/runtime-origin');
            const baseUrl = getConfiguredAppUrl();
            const tenantQuery = tenantId ? `tenantId=${encodeURIComponent(tenantId)}` : '';
            const allUrl = `${baseUrl}/api/shoutout-audit/download${tenantQuery ? `?${tenantQuery}` : ''}`;
            const filteredUrl = arg && arg.toLowerCase() !== 'all'
                ? `${baseUrl}/api/shoutout-audit/download?${tenantQuery ? `${tenantQuery}&` : ''}username=${encodeURIComponent(arg)}`
                : '';
            const liveFilesUrl = `${baseUrl}/debug/data-files${tenantQuery ? `?${tenantQuery}` : ''}`;
            const message = filteredUrl
                ? `Shoutout audit for ${arg}: ${filteredUrl} | All: ${allUrl} | Live Files: ${liveFilesUrl}`
                : `Shoutout audit downloads: ${allUrl} | Per streamer: !shoutoutaudit @username | Live Files: ${liveFilesUrl}`;

            await reply(message, 'bot').catch(() => {});
            return;
        }

        // Handle !show command for Pokemon cards (BEFORE command store check)
        if (actualMessage.toLowerCase().startsWith('!show ')) {
          const searchName = actualMessage.substring(6).trim().toLowerCase();
          if (!searchName) {
            await reply(`@${actualUsername}, usage: !show <card name>`, 'broadcaster').catch(() => {});
            return;
          }

          const path = require('path');
          const fs = require('fs');
          const CARDS_DB_DIR = path.join(process.cwd(), 'pokemon-tcg-data-master', 'cards', 'en');
          const { getUserCards } = require('./pokemon-collection');
          const userCards = await getUserCards(actualUsername);

          // Find owned cards matching the search (exact then partial)
          let owned = userCards.filter((c: any) => c.name.toLowerCase() === searchName);
          if (owned.length === 0) {
            owned = userCards.filter((c: any) => c.name.toLowerCase().includes(searchName));
          }

          if (owned.length === 0) {
            await reply(`@${actualUsername}, you don't own any card matching "${searchName}".`, 'broadcaster').catch(() => {});
            return;
          }

          // Dedupe by setCode+number, keep first of each
          const seen = new Set<string>();
          const unique = owned.filter((c: any) => {
            const key = `${c.setCode}-${c.number}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          });

          for (const card of unique) {
            // Look up full TCG data for stats
            let tcg: any = null;
            try {
              const setData = JSON.parse(fs.readFileSync(path.join(CARDS_DB_DIR, `${card.setCode}.json`), 'utf-8'));
              tcg = setData.find((c: any) => c.number === card.number);
            } catch {}

            const count = userCards.filter((c: any) => c.number === card.number && c.setCode === card.setCode).length;
            const info = [
              card.name,
              tcg?.level ? `Lv.${tcg.level}` : '',
              `#${card.number}`,
              `Set: ${card.setCode}`,
              card.rarity || 'Common',
              tcg?.hp ? `HP: ${tcg.hp}` : '',
              tcg?.types ? `Type: ${tcg.types.join('/')}` : '',
              tcg?.attacks?.length ? `Attacks: ${tcg.attacks.map((a: any) => `${a.name} (${a.damage || 0})`).join(', ')}` : '',
              tcg?.weaknesses?.length ? `Weak: ${tcg.weaknesses.map((w: any) => w.type).join('/')}` : '',
              `(owned: ${count}x)`
            ].filter(Boolean).join(' | ');

            await reply(`@${actualUsername}: ${info}`, 'broadcaster').catch(() => {});

            if (typeof (global as any).broadcast === 'function') {
              (global as any).broadcast({
                type: 'pokemon-show-card',
                payload: {
                  imageUrl: tcg?.images?.large || card.imageUrl,
                  name: card.name,
                  number: card.number,
                  setCode: card.setCode,
                  rarity: card.rarity,
                  hp: tcg?.hp,
                  types: tcg?.types,
                  level: tcg?.level,
                  attacks: tcg?.attacks,
                  abilities: tcg?.abilities,
                  weaknesses: tcg?.weaknesses,
                  resistances: tcg?.resistances,
                  username: actualUsername,
                  owned: count
                }
              }, tenantId);
            }
          }
          return;
        }
        // Handle !t one-off translation for mods
        if (actualMessage.toLowerCase().startsWith('!t ')) {
            const args = actualMessage.substring(3).trim().split(/\s+/);
            const translated = await handleOneOffTranslation(args);
            if (translated) {
                await reply(translated, 'bot').catch(() => {});
                return;
            }
        }
        

        // Handle !addpoints command (mod/broadcaster only)
        if (actualMessage.toLowerCase().startsWith('!addpoints ')) {
            if (tags.mod || tags.badges?.broadcaster) {
                const args = actualMessage.substring(11).trim().split(/\s+/);
                const targetUser = args[0]?.replace('@', '');
                const amount = parseInt(args[1]);
                if (!targetUser || isNaN(amount)) {
                    await reply(`@${actualUsername}, usage: !addPoints @user amount`, 'bot').catch(() => {});
                } else {
                    const result = await addPoints(targetUser, amount, `addpoints by ${actualUsername}`, tenantCtx);
                    await reply(`@${targetUser} now has ${result.pointsDisplay} pts (${amount > 0 ? '+' : ''}${formatCompactPointAmount(amount)})`, 'broadcaster').catch(() => {});
                }
            } else {
                await reply(`@${actualUsername}, only mods can use that!`, 'bot').catch(() => {});
            }
            return;
        }
        
        // Handle !setpoints command (mod/broadcaster only)
        if (actualMessage.toLowerCase().startsWith('!setpoints ')) {
            if (tags.mod || tags.badges?.broadcaster) {
                const args = actualMessage.substring(11).trim().split(/\s+/);
                const targetUser = args[0]?.replace('@', '');
                const amount = parseInt(args[1]);
                if (!targetUser || isNaN(amount)) {
                    await reply(`@${actualUsername}, usage: !setPoints @user amount`, 'bot').catch(() => {});
                } else {
                    const result = await setPoints(targetUser, amount, tenantCtx);
                    await reply(`@${targetUser} set to ${result.pointsDisplay} pts`, 'broadcaster').catch(() => {});
                }
            } else {
                await reply(`@${actualUsername}, only mods can use that!`, 'bot').catch(() => {});
            }
            return;
        }
        
        // Handle !addtoall command (mod/broadcaster only)
        if (actualMessage.toLowerCase().startsWith('!addtoall ')) {
            if (tags.mod || tags.badges?.broadcaster) {
                const amount = parseInt(actualMessage.substring(10).trim());
                if (isNaN(amount)) {
                    await reply(`@${actualUsername}, usage: !addToAll amount`, 'bot').catch(() => {});
                } else {
                    const { addPointsToAll } = require('./points');
                    const count = await addPointsToAll(amount, tenantCtx);
                    await reply(`${amount > 0 ? '+' : ''}${formatCompactPointAmount(amount)} pts to ${count} users!`, 'broadcaster').catch(() => {});
                }
            } else {
                await reply(`@${actualUsername}, only mods can use that!`, 'bot').catch(() => {});
            }
            return;
        }
        
        // Handle !settoall command (mod/broadcaster only)
        if (actualMessage.toLowerCase().startsWith('!settoall ')) {
            if (tags.mod || tags.badges?.broadcaster) {
                const amount = parseInt(actualMessage.substring(10).trim());
                if (isNaN(amount)) {
                    await reply(`@${actualUsername}, usage: !setToAll amount`, 'bot').catch(() => {});
                } else {
                    const { setPointsToAll } = require('./points');
                    const count = await setPointsToAll(amount, tenantCtx);
                    await reply(`Set ${count} users to ${formatCompactPointAmount(amount)} pts`, 'broadcaster').catch(() => {});
                }
            } else {
                await reply(`@${actualUsername}, only mods can use that!`, 'bot').catch(() => {});
            }
            return;
        }
        
        // Handle !ignore command (mod/broadcaster only) - add/remove from known bots
        if (actualMessage.toLowerCase().startsWith('!ignore')) {
            if (tags.mod || tags.badges?.broadcaster) {
                const args = actualMessage.substring(7).trim();
                const targetUser = args.replace('@', '').toLowerCase();
                if (!targetUser) {
                    await reply(`@${actualUsername}, usage: !ignore @username, !ignore all, or !ignore bot name`, 'bot').catch(() => {});
                    return;
                }
                if (targetUser === 'all') {
                    const { toggleBotTriggerIgnoreAll } = await import('../lib/bot-trigger-ignore-store');
                    const config = await toggleBotTriggerIgnoreAll(tenantId);
                    await reply(`@${actualUsername}, bot trigger ignore-all is ${config.all ? 'ON' : 'OFF'}.`, 'bot').catch(() => {});
                    return;
                }
                try {
                    const { readWorldLore } = await import('../lib/world-lore-store');
                    const { toggleIgnoredBotTrigger } = await import('../lib/bot-trigger-ignore-store');
                    const lore = await readWorldLore();
                    const characters = Object.values(lore?.characters || {});
                    const targetLower = targetUser.toLowerCase();
                    const botCharacter = characters.find((character) => {
                        const names = [character.currentName, ...(character.aliases || []), ...(character.previousNames || [])];
                        return names.some((name) => name.toLowerCase() === targetLower);
                    });
                    if (botCharacter) {
                        const result = await toggleIgnoredBotTrigger({
                            tenantId: botCharacter.stableId.split(':')[0],
                            stableId: botCharacter.stableId,
                            botName: botCharacter.currentName,
                            trigger: targetUser,
                        }, tenantId);
                        await reply(`@${actualUsername}, bot trigger ignore for ${botCharacter.currentName}: ${result.ignored ? 'ON' : 'OFF'}.`, 'bot').catch(() => {});
                        return;
                    }
                } catch (error) {
                    console.warn('[Dispatcher] Bot trigger ignore lookup failed:', error);
                }
                const { isKnownBot: checkBot, addCustomBot, removeCustomBot, clearBotCache } = require('./known-bots');
                const alreadyIgnored = await checkBot(targetUser, tenantId);
                if (alreadyIgnored) {
                    await removeCustomBot(targetUser, tenantId);
                    clearBotCache(tenantId);
                    await reply(`@${actualUsername}, ${targetUser} removed from ignore list.`, 'bot').catch(() => {});
                } else {
                    await addCustomBot(targetUser, tenantId);
                    clearBotCache(tenantId);
                    await reply(`@${actualUsername}, ${targetUser} added to ignore list (no welcome/shoutout/points).`, 'bot').catch(() => {});
                }
            } else {
                await reply(`@${actualUsername}, only mods can manage the ignore list!`, 'bot').catch(() => {});
            }
            return;
        }

        // Handle !resetallpoints command (mod/broadcaster only)
        if (actualMessage.toLowerCase() === '!resetallpoints') {
            if (tags.mod || tags.badges?.broadcaster) {
                const { resetAllPoints } = require('./points');
                const count = await resetAllPoints(tenantCtx);
                await reply(`Reset points for ${count} users to 0`, 'broadcaster').catch(() => {});
            } else {
                await reply(`@${actualUsername}, only mods can use that!`, 'bot').catch(() => {});
            }
            return;
        }
        
        // Handle !givepoints command
        if (actualMessage.toLowerCase().startsWith('!givepoints ')) {
            const args = actualMessage.substring(12).trim().split(/\s+/);
            const targetUser = args[0]?.replace('@', '');
            const amount = parseInt(args[1]);
            
            if (!targetUser || isNaN(amount)) {
                await reply(`@${actualUsername}, usage: !givepoints @user amount`, 'bot').catch(() => {});
                return;
            }
            
            const result = await givePoints(actualUsername, targetUser, amount, tenantCtx);
            await reply(result.message, 'bot').catch(() => {});
            return;
        }
        
        // Handle !stealpoints command
        if (actualMessage.toLowerCase().startsWith('!stealpoints ')) {
            const args = actualMessage.substring(13).trim().split(/\s+/);
            const targetUser = args[0]?.replace('@', '');
            const amountText = args[1] || '';
            const amount = /^\d+$/.test(amountText) ? Number(amountText) : NaN;
            
            if (!targetUser || !Number.isSafeInteger(amount)) {
                await reply(`@${actualUsername}, usage: !stealpoints @user amount`, 'bot').catch(() => {});
                return;
            }
            
            const result = await stealPoints(actualUsername, targetUser, amount, tenantCtx);
            await reply(result.message, 'bot').catch(() => {});
            return;
        }
        
        // Handle !gamblemode command
        if (actualMessage.toLowerCase() === '!gamblemode') {
            if (tags.mod || tags.badges?.broadcaster) {
                const { toggleMode } = await import('./modes-manager');
                const toggled = await toggleMode('gamblemode', tenantId);
                await reply(`🎰 Gamble mode: ${toggled.current.toUpperCase()}`, 'bot').catch(() => {});
            } else {
                await reply(`@${actualUsername}, only mods can change gamble mode!`, 'bot').catch(() => {});
            }
            return;
        }
        
        // Handle !greetingmode command
        if (actualMessage.toLowerCase() === '!greetingmode') {
            if (tags.mod || tags.badges?.broadcaster) {
                const { toggleMode } = await import('./modes-manager');
                const toggled = await toggleMode('greetingmode', tenantId);
                const labels: Record<string, string> = { full: '🎬 FULL (clip + chat + TTS)', overlay: '📺 OVERLAY (clip + overlay + TTS)', chat: '💬 CHAT (message only, no clip/TTS)' };
                await reply(`🤖 Greeting mode: ${labels[toggled.current] || toggled.current}`, 'bot').catch(() => {});
            } else {
                await reply(`@${actualUsername}, only mods can change greeting mode!`, 'bot').catch(() => {});
            }
            return;
        }
        
        // Handle !welcomemode command
        if (actualMessage.toLowerCase() === '!welcomemode') {
            if (tags.mod || tags.badges?.broadcaster) {
                const { toggleMode } = await import('./modes-manager');
                const toggled = await toggleMode('welcomemode', tenantId);
                await reply(`🎉 Welcome mode: ${toggled.current.toUpperCase()}`, 'bot').catch(() => {});
            } else {
                await reply(`@${actualUsername}, only mods can change welcome mode!`, 'bot').catch(() => {});
            }
            return;
        }
        
        // Handle !clipmode command
        if (actualMessage.toLowerCase() === '!clipmode') {
            if (tags.mod || tags.badges?.broadcaster) {
                const { toggleMode } = await import('./modes-manager');
                const toggled = await toggleMode('clipmode', tenantId);
                await reply(`🎬 Clip mode: ${toggled.current.toUpperCase()}`, 'bot').catch(() => {});
            }
            return;
        }
        
        // Handle !pokemode command
        if (actualMessage.toLowerCase() === '!pokemode') {
            if (tags.mod || tags.badges?.broadcaster) {
                const { toggleMode } = await import('./modes-manager');
                const toggled = await toggleMode('pokemode', tenantId);
                await reply(`🃏 Pokemon mode: ${toggled.current.toUpperCase()}`, 'bot').catch(() => {});
            }
            return;
        }
        
        // Handle !gamble command (Classic Chat Gamble)
        if (actualMessage.toLowerCase().startsWith('!gamble ')) {
            const betInput = actualMessage.substring(8).trim();
            const userPoints = await getPointBalance(actualUsername, tenantCtx);
            const result = await handleClassicGamble(actualUsername, betInput, userPoints, tenantId);
            if (result) {
                await setPoints(actualUsername, result.newTotal, tenantCtx);
            }
            return;
        }
        
        // Handle !gamble with no args (use default)
        if (actualMessage.toLowerCase() === '!gamble') {
            const userPoints = await getPointBalance(actualUsername, tenantCtx);
            const result = await handleClassicGamble(actualUsername, '', userPoints, tenantId);
            if (result) {
                await setPoints(actualUsername, result.newTotal, tenantCtx);
            }
            return;
        }
        

        
        // Handle !roll command
        if (actualMessage.toLowerCase().startsWith('!roll ')) {
            const betInput = actualMessage.substring(6).trim();
            const userPoints = await getPointBalance(actualUsername, tenantCtx);
            const result = await handleRoll(actualUsername, betInput, userPoints, tenantId);
            if (result) {
                await setPoints(actualUsername, result.newTotal, tenantCtx);
                // Store double-or-nothing state (30 second window)
                const doubleState = { username: actualUsername, wager: result.change.startsWith('-') ? result.change.slice(1) : result.change || betInput, expires: Date.now() + 30000 };
                if (!(global as any).doubleOrNothingStates) (global as any).doubleOrNothingStates = new Map();
                (global as any).doubleOrNothingStates.set(actualUsername.toLowerCase(), doubleState);
            }
            return;
        }
        
        // Handle !double command (double or nothing)
        if (actualMessage.toLowerCase() === '!double') {
            const states = (global as any).doubleOrNothingStates as Map<string, any> | undefined;
            const doubleState = states?.get(actualUsername.toLowerCase());
            if (!doubleState || Date.now() > doubleState.expires) {
                await reply(`@${actualUsername}, no active double-or-nothing available!`, 'bot').catch(() => {});
                return;
            }
            
            const userPoints = await getPointBalance(actualUsername, tenantCtx);
            const result = await handleDouble(actualUsername, doubleState.wager, userPoints, tenantId);
            if (result) {
                await setPoints(actualUsername, result.newTotal, tenantCtx);
            }
            
            states?.delete(actualUsername.toLowerCase());
            return;
        }
        

        
        // Handle !brb command
        if (actualMessage.toLowerCase().includes('be right back') || actualMessage.toLowerCase() === '!brb') {
            if (tags.mod || tags.badges?.broadcaster) {
                const broadcasterName = broadcasterUsername;
                startBRB(broadcasterName, tenantId).catch(err => console.error('[BRB] Error:', err));
                await reply('🎬 Starting BRB clip player...', 'bot').catch(() => {});
            }
            return;
        }
        
        // Handle !back command
        if (actualMessage.toLowerCase() === '!back') {
            if (tags.mod || tags.badges?.broadcaster) {
                stopBRB();
                // Immediately stop overlay and switch scene back
                if (typeof (global as any).broadcast === 'function') {
                    (global as any).broadcast({ type: 'brb-stop' }, tenantId);
                    try {
                        const { getConfigSection: gcs } = require('../lib/local-config/service');
                        const obsConfig = await gcs('obs', tenantId);
                        const liveScene = obsConfig?.scenes?.live || 'Live';
                        (global as any).broadcast({ type: 'obs-switch-scene', payload: { sceneName: liveScene } }, tenantId);
                    } catch {}
                }
                await reply('👋 Welcome back!', 'bot').catch(() => {});
            }
            return;
        }
        

        
        // Handle !chatmode command - now master toggle for ALL modes
        if (actualMessage.toLowerCase() === '!chatmode') {
            if (tags.mod || tags.badges?.broadcaster) {
                const { toggleMasterChatmode } = await import('./modes-manager');
                await toggleMasterChatmode(tenantId);
                const modes = await (await import('./modes-manager')).getAllModes(tenantId);
                await reply(
                    `🎛️ MASTER MODE: ${modes.chatmode.toUpperCase()} — All modes synced: Gamble(${modes.gamblemode}), Welcome(${modes.welcomemode}), Greeting(${modes.greetingmode}), Clip(${modes.clipmode})`,
                    'bot'
                ).catch(() => {});
            } else {
                await reply(`@${actualUsername}, only mods can change master chat mode!`, 'bot').catch(() => {});
            }
            return;
        }

        // Handle !botshare command - opt-in controlled bot-to-bot lore interactions
        if (actualMessage.toLowerCase() === '!botshare') {
            if (tags.mod || tags.badges?.broadcaster) {
                const { toggleBotShareMode } = await import('../lib/bot-interactions-store');
                const mode = await toggleBotShareMode(tenantId);
                await reply(`Bot share mode: ${mode.toUpperCase()} - cross-bot replies are ${mode === 'on' ? 'enabled' : 'disabled'}.`, 'bot').catch(() => {});
            } else {
                await reply(`@${actualUsername}, only mods can change bot share mode!`, 'bot').catch(() => {});
            }
            return;
        }
        // Handle !athenaeverywhere command - global Athena replies in watched/shared Twitch chats
        const athenaEverywhereMatch = actualMessage.toLowerCase().trim().match(/^!athenaeverywhere(?:\s+(on|off|status))?$/);
        if (athenaEverywhereMatch) {
            if (tags.mod || tags.badges?.broadcaster) {
                const action = athenaEverywhereMatch[1];
                const mode = action === 'on' || action === 'off'
                    ? await setAthenaEverywhereMode(action)
                    : action === 'status'
                        ? await getAthenaEverywhereMode()
                        : await toggleAthenaEverywhereMode();
                await reply(`Athena everywhere mode: ${mode.toUpperCase()} - Athena mentions in watched/shared chats ${mode === 'on' ? 'route to Athenabot87' : 'stay local'}.`, 'bot').catch(() => {});
            } else {
                await reply(`@${actualUsername}, only mods can change Athena everywhere mode!`, 'bot').catch(() => {});
            }
            return;
        }
        // Handle !sr command - Re-send as plain !sr so HearMeOut's Twitch bot picks it up
        if (actualMessage.toLowerCase().startsWith('!sr ')) {
            await reply(actualMessage, 'bot').catch(() => {});
            return;
        }

        // Handle !bic command - Lighter theft tracker (global across all streams)
        if (actualMessage.toLowerCase().startsWith('!bic')) {
            const args = actualMessage.substring(4).trim();
            try {
                const { getBicData, stealLighter, removeLighter, getVictimList, isBlacklisted, addToBlacklist, removeFromBlacklist } = require('./bic-storage');

                // !bic (no args) or !bic list [page] = show paginated leaderboard
                if (!args || args.toLowerCase().startsWith('list')) {
                    const data = getBicData();
                    const victims = getVictimList();
                    if (victims.length === 0) { await reply(`No lighters have been stolen yet!`, 'bot').catch(() => {}); return; }
                    const PAGE_SIZE = 10;
                    const pageArg = args ? parseInt(args.replace(/^list\s*/i, '')) : 1;
                    const page = (isNaN(pageArg) || pageArg < 1) ? 1 : pageArg;
                    const totalPages = Math.ceil(victims.length / PAGE_SIZE);
                    const pageVictims = victims.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
                    const list = pageVictims.map((v: { name: string; count: number }) => `${v.name}: ${v.count}`).join(', ');
                    let urlPart = '';
                    try {
                        const { getConfiguredAppUrl } = require('../lib/runtime-origin');
                        const fullUrl = `${getConfiguredAppUrl()}/api/bic-list`;
                        try { const tinyRes = await fetch(`https://tinyurl.com/api-create.php?url=${encodeURIComponent(fullUrl)}`, { signal: AbortSignal.timeout(3000) }); if (tinyRes.ok) { const short = await tinyRes.text(); if (short.startsWith('http')) urlPart = ` | Full list: ${short}`; } } catch {}
                        if (!urlPart) urlPart = ` | Full list: ${fullUrl}`;
                    } catch {}
                    const pagePart = totalPages > 1 ? ` (pg ${page}/${totalPages} — !bic list ${page + 1})` : '';
                    await reply(`🔥 ${data.total} lighters stolen! Victims: ${list}${pagePart}${urlPart}`, 'bot').catch(() => {});
                    return;
                }
                // !bic remove @user
                if (args.toLowerCase().startsWith('remove ')) {
                    if (!(tags.mod || tags.badges?.broadcaster)) { await reply(`@${actualUsername}, only mods can remove bic entries!`, 'bot').catch(() => {}); return; }
                    const removeTarget = args.substring(7).trim().replace('@', '').toLowerCase();
                    if (!removeTarget) { await reply(`@${actualUsername}, usage: !bic remove @user`, 'bot').catch(() => {}); return; }
                    const { total, userCount } = removeLighter(removeTarget);
                    await reply(`Removed 1 lighter from ${removeTarget}. Total: ${total}, ${removeTarget}: ${userCount}`, 'bot').catch(() => {});
                    const { publishBicOverlay } = require('./bic-service');
                    await publishBicOverlay({ total, lastUser: removeTarget, lastUserCount: userCount });
                    return;
                }
                // !bic blacklist @user
                if (args.toLowerCase().startsWith('blacklist ')) {
                    if (!(tags.mod || tags.badges?.broadcaster)) { await reply(`@${actualUsername}, only mods can manage the bic blacklist!`, 'bot').catch(() => {}); return; }
                    const blTarget = args.substring(10).trim().replace('@', '').toLowerCase();
                    if (!blTarget) { await reply(`@${actualUsername}, usage: !bic blacklist @user`, 'bot').catch(() => {}); return; }
                    if (addToBlacklist(blTarget)) await reply(`${blTarget} added to bic blacklist`, 'bot').catch(() => {});
                    else await reply(`${blTarget} is already blacklisted`, 'bot').catch(() => {});
                    return;
                }
                // !bic unblacklist @user
                if (args.toLowerCase().startsWith('unblacklist ')) {
                    if (!(tags.mod || tags.badges?.broadcaster)) { await reply(`@${actualUsername}, only mods can manage the bic blacklist!`, 'bot').catch(() => {}); return; }
                    const ublTarget = args.substring(12).trim().replace('@', '').toLowerCase();
                    if (!ublTarget) { await reply(`@${actualUsername}, usage: !bic unblacklist @user`, 'bot').catch(() => {}); return; }
                    if (removeFromBlacklist(ublTarget)) await reply(`${ublTarget} removed from bic blacklist`, 'bot').catch(() => {});
                    else await reply(`${ublTarget} is not blacklisted`, 'bot').catch(() => {});
                    return;
                }
                // !bic @user = steal a lighter
                const targetUser = args.replace('@', '').toLowerCase();
                if (isBlacklisted(targetUser)) { await reply(`@${actualUsername}, ${targetUser} is protected from lighter theft!`, 'bot').catch(() => {}); return; }
                const { total, userCount } = stealLighter(targetUser);
                await reply(`🔥 fatkid4ev4 has stolen ${total} lighters, of those ${userCount} have been ${targetUser}'s`, 'bot').catch(() => {});
                const { publishBicOverlay } = require('./bic-service');
                await publishBicOverlay({ total, lastUser: targetUser, lastUserCount: userCount });
                // Notify fatkid's stream about the lighter theft
                if (tenantId !== '757276653') {
                    sendChatMessage(`🔥 fatkid4ev4 stole ${targetUser}'s lighter! (${total} total stolen, ${userCount} from ${targetUser})`, 'bot', undefined, '757276653').catch(() => {});
                }
            } catch (err) {
                console.error('[Bic] Error:', err);
            }
            return;
        }
        
        if (actualMessage.toLowerCase().startsWith('!so ')) {
            const targetName = actualMessage.substring(4).trim().replace('@', '');
            if (targetName) {
                console.log(`[Dispatcher] Processing !so shoutout for ${targetName}`);
                incrementMetric('shoutoutsGiven').catch(() => {});
                const profileImage = `https://static-cdn.jtvnw.net/jtv_user_pictures/${targetName}-profile_image-300x300.png`;
                await handleWalkOnShoutout(targetName, targetName, profileImage, true, tenantId).catch(err => {
                    console.error('[Dispatcher] !so shoutout failed:', err);
                    reply(`@${actualUsername}, shoutout failed: ${err.message}`, 'bot').catch(() => {});
                });
            }
            return;
        }
        

        // Handle !offer command (Pokemon trade)
        if (actualMessage.toLowerCase().startsWith('!offer ')) {
            const cardIdentifier = actualMessage.substring(7).trim();
            const { offerCard } = require('./pokemon-trade-manager');
            await offerCard(actualUsername, cardIdentifier, tenantId);
            return;
        }
        
        // Handle !accept command (check swaps first, then Pokemon trade)
        if (actualMessage.toLowerCase() === '!accept') {
            const { acceptSwap, hasPendingSwap } = require('./pokemon-swap');
            if (hasPendingSwap(actualUsername, tenantId)) {
                await acceptSwap(actualUsername, tenantId);
                return;
            }
            const { acceptTrade } = require('./pokemon-trade-manager');
            await acceptTrade(actualUsername, tenantId);
            return;
        }
        
        // Handle !cancel command (check swaps first, then Pokemon trade)
        if (actualMessage.toLowerCase() === '!cancel') {
            const { cancelSwap, hasPendingSwap } = require('./pokemon-swap');
            if (hasPendingSwap(actualUsername, tenantId)) {
                await cancelSwap(actualUsername, tenantId);
                return;
            }
            const { cancelTrade } = require('./pokemon-trade-manager');
            await cancelTrade(actualUsername, tenantId);
            return;
        }
        
        // Handle !swap command — one-shot trade proposal
        if (actualMessage.toLowerCase().startsWith('!swap ')) {
            const parts = actualMessage.substring(6).trim().match(/^@?(\S+)\s+(\d+)\s+for\s+(\d+)$/i);
            if (!parts) {
                await reply(`@${actualUsername}, usage: !swap @user <your card#> for <their card#>`, 'broadcaster').catch(() => {});
                return;
            }
            const targetUser = parts[1].replace('@', '');
            const myCard = parseInt(parts[2]);
            const theirCard = parseInt(parts[3]);
            if (targetUser.toLowerCase() === actualUsername.toLowerCase()) {
                await reply(`@${actualUsername}, you can't swap with yourself!`, 'broadcaster').catch(() => {});
                return;
            }
            const { proposeSwap } = require('./pokemon-swap');
            await proposeSwap(actualUsername, targetUser, myCard, theirCard, tenantId);
            return;
        }

        // Handle !deck command - view saved deck
        if (actualMessage.toLowerCase() === '!deck') {
            const { getUserCollection } = require('./pokemon-storage-discord');
            const col = await getUserCollection(actualUsername);
            if (!col.deck || !col.deck.cards?.length) {
                await reply(`@${actualUsername}, you don't have a deck yet. Use the Pok\u00e9dex deck builder and !setdeck to save one.`, 'broadcaster').catch(() => {});
                return;
            }
            const { getUserCards } = require('./pokemon-collection');
            const cards = await getUserCards(actualUsername);
            const names = col.deck.cards.slice(0, 8).map((idx: number) => cards[idx - 1]?.name || '?').join(', ');
            const energyStr = Object.entries(col.deck.energy || {}).filter(([, n]) => (n as number) > 0).map(([t, n]) => `${n} ${t}`).join(', ');
            const total = col.deck.cards.length + Object.values(col.deck.energy || {}).reduce((a: number, b: any) => a + Number(b), 0);
            await reply(`@${actualUsername}'s deck (${total}/40): ${names}${col.deck.cards.length > 8 ? '...' : ''}${energyStr ? ' | Energy: ' + energyStr : ''}`, 'broadcaster').catch(() => {});
            return;
        }

        // Handle !setdeck command - save a 40-card deck from base64
        if (actualMessage.toLowerCase().startsWith('!setdeck ')) {
            const encoded = actualMessage.substring(9).trim();
            try {
                const decoded = JSON.parse(Buffer.from(encoded, 'base64').toString('utf-8'));
                if (!decoded.cards || !Array.isArray(decoded.cards)) throw new Error('bad format');
                const energy: Record<string, number> = decoded.energy || {};
                const energyTotal = Object.values(energy).reduce((a: number, b: any) => a + Number(b), 0);
                const total = decoded.cards.length + energyTotal;
                if (total !== 40) {
                    await reply(`@${actualUsername}, deck must be exactly 40 cards (got ${total}).`, 'broadcaster').catch(() => {});
                    return;
                }
                const { getUserCards } = require('./pokemon-collection');
                const cards = await getUserCards(actualUsername);
                const invalid = decoded.cards.find((idx: number) => !cards[idx - 1]);
                if (invalid) {
                    await reply(`@${actualUsername}, card #${invalid} doesn't exist in your collection!`, 'broadcaster').catch(() => {});
                    return;
                }
                const { getUserCollection, saveUserCollection } = require('./pokemon-storage-discord');
                const col = await getUserCollection(actualUsername);
                col.deck = { cards: decoded.cards, energy };
                await saveUserCollection(actualUsername, col);
                const pokemonCount = decoded.cards.filter((idx: number) => {
                    const c = cards[idx - 1];
                    try {
                        const setData = JSON.parse(require('fs').readFileSync(require('path').join(process.cwd(), 'pokemon-tcg-data-master', 'cards', 'en', `${c.setCode}.json`), 'utf-8'));
                        const tcg = setData.find((t: any) => t.number === c.number);
                        return tcg?.supertype === 'Pok\u00e9mon';
                    } catch { return false; }
                }).length;
                await reply(`@${actualUsername}, deck saved! ${decoded.cards.length} cards + ${energyTotal} energy (${pokemonCount} Pok\u00e9mon).`, 'broadcaster').catch(() => {});
            } catch {
                await reply(`@${actualUsername}, invalid deck code. Use the Pok\u00e9dex deck builder to generate one.`, 'broadcaster').catch(() => {});
            }
            return;
        }

        // Handle !gymteam command - set 3 cards for gym battles
        if (actualMessage.toLowerCase().startsWith('!gymteam')) {
            const args = actualMessage.substring(8).trim().split(/\s+/);
            if (args.length !== 3 || args.some(a => !a.includes('-'))) {
                await reply(`@${actualUsername}, usage: !gymteam <set-num> <set-num> <set-num> (e.g. !gymteam base1-4 base6-3 gym2-15)`, 'broadcaster').catch(() => {});
                return;
            }
            const { getUserCards } = require('./pokemon-collection');
            const cards = await getUserCards(actualUsername);
            const matched = args.map((id: string) => cards.find((c: any) => `${c.setCode}-${c.number}` === id));
            const missing = args.filter((_: string, i: number) => !matched[i]);
            if (missing.length) {
                await reply(`@${actualUsername}, card(s) not found in your collection: ${missing.join(', ')}`, 'broadcaster').catch(() => {});
                return;
            }
            // Verify all are Pokemon
            const fs = require('fs');
            const path = require('path');
            const CARDS_DIR = path.join(process.cwd(), 'pokemon-tcg-data-master', 'cards', 'en');
            for (const c of matched) {
                try {
                    const setData = JSON.parse(fs.readFileSync(path.join(CARDS_DIR, `${c.setCode}.json`), 'utf-8'));
                    const tcg = setData.find((t: any) => t.number === c.number);
                    if (tcg && tcg.supertype !== 'Pok\u00e9mon') {
                        await reply(`@${actualUsername}, ${c.name} (${c.setCode}-${c.number}) is not a Pok\u00e9mon!`, 'broadcaster').catch(() => {});
                        return;
                    }
                } catch {}
            }
            const { setGymTeam } = require('./gym-team');
            await setGymTeam(actualUsername, args);
            const names = matched.map((c: any) => `${c.name} (${c.setCode}-${c.number})`).join(', ');
            await reply(`@${actualUsername}, gym team set: ${names}`, 'broadcaster').catch(() => {});
            return;
        }

        // Handle !challenge command (Gym Battle queue)
        if (actualMessage.toLowerCase() === '!challenge') {
            const { joinQueue } = require('./gym-battle');
            await joinQueue(actualUsername, tenantId);
            return;
        }
        


        // Handle !testswap command (mod-only — propose and auto-accept a swap for overlay testing)
        if (actualMessage.toLowerCase() === '!testswap') {
            if (tags.mod || tags.badges?.broadcaster) {
                const { proposeSwap, acceptSwap } = require('./pokemon-swap');
                await proposeSwap(actualUsername, 'akhiteddy', 1, 1, tenantId);
                setTimeout(async () => {
                    await acceptSwap('akhiteddy', tenantId);
                }, 5000);
            }
            return;
        }

        // Handle !testgym command (mod-only test battle)
        if (actualMessage.toLowerCase() === '!testgym') {
            if (tags.mod || tags.badges?.broadcaster) {
                const { testGymBattle } = require('./gym-battle');
                await testGymBattle(tenantId);
            }
            return;
        }

        // Handle !nextchallenger command (Streamer starts next battle)
        if (actualMessage.toLowerCase() === '!nextchallenger') {
            if (tags.mod || tags.badges?.broadcaster) {
                const { startNextBattle } = require('./gym-battle');
                await startNextBattle(tenantId);
            } else {
                await reply(`@${actualUsername}, only the gym leader can start battles!`, 'broadcaster').catch(() => {});
            }
            return;
        }
        
        // Handle !attack command (Gym Battle)
        if (actualMessage.toLowerCase() === '!attack') {
            const { battleAttack } = require('./gym-battle');
            await battleAttack(actualUsername, tenantId);
            return;
        }
        
        // Handle !switch command (Gym Battle)
        if (actualMessage.toLowerCase() === '!switch') {
            const { battleSwitch } = require('./gym-battle');
            await battleSwitch(actualUsername, tenantId);
            return;
        }
        
        // Handle !clip command
        if (actualMessage.toLowerCase() === '!clip') {
            try {
                const response = await fetch(`http://127.0.0.1:${process.env.PORT||3100}/api/twitch/create-clip`, { 
                    method: 'POST',
                    signal: AbortSignal.timeout(10000),
                });
                if (response.ok) {
                    const data = await response.json();
                    if (data.url) {
                        await reply(`📹 Clip created! ${data.url}`, 'broadcaster').catch(() => {});
                    } else {
                        await reply(`@${actualUsername}, clip created but no URL returned!`, 'broadcaster').catch(() => {});
                    }
                } else {
                    const errorText = await response.text().catch(() => 'Unknown error');
                    console.error('[Dispatcher] Clip creation failed:', response.status, errorText);
                    await reply(`@${actualUsername}, failed to create clip! (${response.status})`, 'broadcaster').catch(() => {});
                }
            } catch (error) {
                console.error('[Dispatcher] Clip creation failed:', error);
                await reply(`@${actualUsername}, clip creation timed out or failed!`, 'broadcaster').catch(() => {});
            }
            return;
        }
        

        // Handle !followage command
        if (actualMessage.toLowerCase().startsWith('!followage')) {
            const args = actualMessage.substring(11).trim();
            const targetUser = args ? args.replace('@', '') : actualUsername;
            
            try {
                const { getFollowAge } = require('./twitch');
                const followData = await getFollowAge(targetUser, tenantId);
                
                if (followData?.followedAt) {
                    const followDate = new Date(followData.followedAt);
                    const now = new Date();
                    const diffMs = now.getTime() - followDate.getTime();
                    const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
                    const years = Math.floor(days / 365);
                    const months = Math.floor((days % 365) / 30);
                    const remainingDays = days % 30;
                    
                    let timeStr = '';
                    if (years > 0) timeStr += `${years}y `;
                    if (months > 0) timeStr += `${months}m `;
                    timeStr += `${remainingDays}d`;
                    
                    await reply(`@${targetUser} has been following for ${timeStr}!`, 'bot').catch(() => {});
                } else {
                    await reply(`@${targetUser} is not following!`, 'bot').catch(() => {});
                }
            } catch (error) {
                await reply(`@${actualUsername}, couldn't fetch follow data!`, 'bot').catch(() => {});
            }
            return;
        }
        
        // Handle !followed command
        if (actualMessage.toLowerCase() === '!followed') {
            try {
                const { getFollowAge } = require('./twitch');
                const followData = await getFollowAge(actualUsername, tenantId);
                
                if (followData?.followedAt) {
                    const followDate = new Date(followData.followedAt);
                    await reply(`@${actualUsername} followed on ${followDate.toLocaleDateString()}!`, 'broadcaster').catch(() => {});
                } else {
                    await reply(`@${actualUsername}, you're not following!`, 'broadcaster').catch(() => {});
                }
            } catch (error) {
                await reply(`@${actualUsername}, couldn't fetch follow data!`, 'broadcaster').catch(() => {});
            }
            return;
        }
        
        // Handle !followers command
        if (actualMessage.toLowerCase() === '!followers') {
            try {
                const { getChannelInfo } = require('./twitch');
                const info = await getChannelInfo(tenantId);
                if (info) {
                    await reply(`Current followers: ${info.followerCount?.toLocaleString() || 'Unknown'}`, 'broadcaster').catch(() => {});
                } else {
                    await reply(`@${actualUsername}, couldn't fetch follower count!`, 'broadcaster').catch(() => {});
                }
            } catch (error) {
                console.error('[Dispatcher] Followers fetch failed:', error);
                await reply(`@${actualUsername}, couldn't fetch follower count!`, 'broadcaster').catch(() => {});
            }
            return;
        }
        

        // Handle !uptime command
        if (actualMessage.toLowerCase() === '!uptime') {
            try {
                const { getStreamUptime } = require('./twitch');
                const uptime = await getStreamUptime(tenantId);
                if (uptime) {
                    await reply(`Stream uptime: ${uptime.hours}h ${uptime.minutes}m`, 'broadcaster').catch(() => {});
                } else {
                    await reply('Stream is offline!', 'broadcaster').catch(() => {});
                }
            } catch (error) {
                console.error('[Dispatcher] Uptime fetch failed:', error);
                await reply(`@${actualUsername}, couldn't fetch uptime!`, 'broadcaster').catch(() => {});
            }
            return;
        }
        
        // Handle !watchtime command
        if (actualMessage.toLowerCase() === '!watchtime') {
            try {
                const { getUser, formatWatchtime } = require('./user-stats');
                const user = await getUser(actualUsername);
                const msg = formatWatchtime(user);
                await reply(msg, 'bot').catch(() => {});
            } catch (error) {
                console.error('[Dispatcher] Watchtime fetch failed:', error);
                await reply(`@${actualUsername}, couldn't fetch your watchtime!`, 'bot').catch(() => {});
            }
            return;
        }
        
        // Handle !stats command
        if (actualMessage.toLowerCase() === '!stats') {
            try {
                const { getChannelInfo } = require('./twitch');
                const info = await getChannelInfo(tenantId);
                if (info) {
                    await reply(
                        `📊 Followers: ${info.followerCount?.toLocaleString() || 0} | Views: ${info.viewCount?.toLocaleString() || 0}`,
                        'bot'
                    ).catch(() => {});
                } else {
                    await reply(`@${actualUsername}, couldn't fetch stats!`, 'bot').catch(() => {});
                }
            } catch (error) {
                console.error('[Dispatcher] Stats fetch failed:', error);
                await reply(`@${actualUsername}, stats request timed out!`, 'bot').catch(() => {});
            }
            return;
        }
        
        // Handle !setgame command (mod/broadcaster only)
        if (actualMessage.toLowerCase().startsWith('!setgame ')) {
            if (tags.mod || tags.badges?.broadcaster) {
                const game = actualMessage.substring(9).trim();
                try {
                    const { updateChannelInfo } = require('./twitch');
                    const ok = await updateChannelInfo({ game_name: game }, tenantId);
                    if (ok) {
                        await reply(`🎮 Game set to: ${game}`, 'bot').catch(() => {});
                    } else {
                        await reply(`Failed to set game!`, 'bot').catch(() => {});
                    }
                } catch (error) {
                    console.error('[Dispatcher] Set game failed:', error);
                    await reply(`Failed to set game!`, 'bot').catch(() => {});
                }
            } else {
                await reply(`@${actualUsername}, only mods can change the game!`, 'broadcaster').catch(() => {});
            }
            return;
        }
        
        // Handle !settitle command (mod/broadcaster only)
        if (actualMessage.toLowerCase().startsWith('!settitle ')) {
            if (tags.mod || tags.badges?.broadcaster) {
                const title = actualMessage.substring(10).trim();
                try {
                    const { updateChannelInfo } = require('./twitch');
                    const ok = await updateChannelInfo({ title }, tenantId);
                    if (ok) {
                        await reply(`📝 Title set to: ${title}`, 'bot').catch(() => {});
                    } else {
                        await reply(`Failed to set title!`, 'bot').catch(() => {});
                    }
                } catch (error) {
                    console.error('[Dispatcher] Set title failed:', error);
                    await reply(`Failed to set title!`, 'bot').catch(() => {});
                }
            } else {
                await reply(`@${actualUsername}, only mods can change the title!`, 'broadcaster').catch(() => {});
            }
            return;
        }
        
        // Handle !raidmessage command (mod/broadcaster only)
        if (actualMessage.toLowerCase().startsWith('!raidmessage ')) {
            if (tags.mod || tags.badges?.broadcaster) {
                const message = actualMessage.substring(13).trim();
                // Store raid message
                try {
                    const fsSync = require('fs');
                    const pathMod = require('path');
                    const configPath = tenantId
                        ? require('../lib/tenant').tenantPath(tenantId, 'tokens/raid-message.json')
                        : pathMod.join(process.cwd(), 'tokens', 'raid-message.json');
                    fsSync.mkdirSync(pathMod.dirname(configPath), { recursive: true });
                    fsSync.writeFileSync(configPath, JSON.stringify({ message }, null, 2));
                    await reply(`✅ Raid message set!`, 'broadcaster').catch(() => {});
                } catch (error) {
                    console.error('[Dispatcher] Raid message save failed:', error);
                }
            } else {
                await reply(`@${actualUsername}, only mods can set the raid message!`, 'broadcaster').catch(() => {});
            }
            return;
        }
        
        // Handle !commands
        if (actualMessage.toLowerCase() === '!commands') {
            const cmdSummary = '🎮 Fun: !hug,!boop,!cuddle,!dance,!highfive,!lurk,!unlurk | 🎲 Games: !gamble,!roll,!double,!coinflip | 🃏 Pokemon: !pack,!collection,!show <card>,!trade,!swap,!offer,!accept,!challenge,!attack,!switch,!setdeck,!deck | 📊 Info: !points,!followage,!uptime,!time,!watchtime,!stats | 🏆 Leaders: !leader,!pleader,!wleader,!cleader,!bleader | 🔧 Type !admin for mod commands';
            await reply(cmdSummary, 'broadcaster').catch(() => {});
            return;
        }
        
        // Handle leaderboard commands
        if (['!leader', '!pleader', '!wleader', '!cleader', '!bleader', '!bitsleader'].includes(actualMessage.split(' ')[0].toLowerCase())) {
            const cmd = actualMessage.split(' ')[0].toLowerCase();
            const args = actualMessage.substring(cmd.length).trim();
            const broadcastFn = typeof (global as any).broadcast === 'function' ? (global as any).broadcast : () => {};
            await handleLeaderboardCommand(cmd, actualUsername, args, broadcastFn, tenantId);
            return;
        }
        
        // Handle !eevee command — special Eevee booster for mothermayrien
        if (actualMessage.toLowerCase() === '!eevee') {
            if (actualUsername.toLowerCase() !== 'mothermayrien') {
                await reply(`@${actualUsername}, this is mothermayrien's special Eevee pack!`, 'broadcaster').catch(() => {});
                return;
            }
            try {
                const { openEeveePack } = require('./pokemon-packs');
                const result = await openEeveePack(actualUsername, tenantId);
                if (result) {
                    const { getUserCards } = require('./pokemon-collection');
                    const allCards = await getUserCards(actualUsername);
                    const rareCount = allCards.filter((c: any) => c.rarity?.includes('Rare')).length;
                    const cardInfo = result.pack.map((c: any) => `${c.name} (${c.rarity})`).join(', ');
                    await reply(`✨ @${actualUsername} opened an Eevee booster! ${cardInfo} | Total: ${allCards.length} cards (${rareCount} rare)`, 'broadcaster').catch(() => {});
                } else {
                    await reply(`@${actualUsername}, something went wrong opening the Eevee pack!`, 'broadcaster').catch(() => {});
                }
            } catch (e: any) {
                console.error('[Eevee Pack] Error:', e);
            }
            return;
        }


        // Handle !admin
        if (actualMessage.toLowerCase() === '!admin') {
            if (tags.mod || tags.badges?.broadcaster) {
                const adminSummary = '🔧 Admin: !so <user>, !setgame <game>, !settitle <title>, !raidmessage <msg>, !greetingmode, !welcomemode, !clipmode, !chatmode, !botshare, !athenaeverywhere, !brb, !back, !ignore <user>, !addflow <prompt>, !approveflow <!command>, !disableflow <!command>, !deleteflow <!command>';
                await reply(adminSummary, 'broadcaster').catch(() => {});
            } else {
                await reply(`@${actualUsername}, only mods can view admin commands!`, 'broadcaster').catch(() => {});
            }
            return;
        }

        if (actualMessage.toLowerCase().startsWith('!addflow')) {
            if (!tags.mod && !tags.badges?.broadcaster) {
                await reply(`@${actualUsername}, only mods can create AI workflows from chat.`, 'broadcaster').catch(() => {});
                return;
            }

            const prompt = actualMessage.substring('!addflow'.length).trim();
            if (!prompt) {
                await reply(`@${actualUsername}, use !addflow followed by what the workflow should do. Example: !addflow make !go start a 5 minute countdown`, 'broadcaster').catch(() => {});
                return;
            }

            try {
                const { createWorkflowFromPrompt } = await import('./automation/ai-workflow-builder');
                const created = await createWorkflowFromPrompt({
                    message: prompt,
                    tenantId,
                    userName: actualUsername,
                });
                const commandLabel = created.commandText || (created.command ? String(created.command.command || '') : '');
                const reviewNote = created.requiresReview
                    ? ` It includes a programmable step, so review it before enabling.`
                    : '';
                await reply(
                    `${created.action.name} drafted${commandLabel ? ` for ${commandLabel}` : ''}. It is saved disabled.${reviewNote} Use !approveflow ${commandLabel || '<!command>'} to enable it or edit it in Workflows.`,
                    'broadcaster'
                ).catch(() => {});
            } catch (error: any) {
                console.error('[Dispatcher] !addflow failed:', error);
                await reply(`@${actualUsername}, AI flow creation failed: ${error?.message || 'unknown error'}`, 'broadcaster').catch(() => {});
            }
            return;
        }

        if (actualMessage.toLowerCase().startsWith('!approveflow')) {
            if (!tags.mod && !tags.badges?.broadcaster) {
                await reply(`@${actualUsername}, only mods can enable AI workflows from chat.`, 'broadcaster').catch(() => {});
                return;
            }

            const commandText = actualMessage.substring('!approveflow'.length).trim();
            if (!commandText) {
                await reply(`@${actualUsername}, use !approveflow <!command>.`, 'broadcaster').catch(() => {});
                return;
            }

            try {
                const { setWorkflowEnabledByCommand } = await import('./automation/ai-workflow-builder');
                const updated = await setWorkflowEnabledByCommand(commandText, true, tenantId);
                await reply(`Enabled workflow for ${commandText}. Updated ${updated.linkedActions.length} linked action(s).`, 'broadcaster').catch(() => {});
            } catch (error: any) {
                console.error('[Dispatcher] !approveflow failed:', error);
                await reply(`@${actualUsername}, couldn't enable ${commandText}: ${error?.message || 'unknown error'}`, 'broadcaster').catch(() => {});
            }
            return;
        }

        if (actualMessage.toLowerCase().startsWith('!disableflow')) {
            if (!tags.mod && !tags.badges?.broadcaster) {
                await reply(`@${actualUsername}, only mods can disable AI workflows from chat.`, 'broadcaster').catch(() => {});
                return;
            }

            const commandText = actualMessage.substring('!disableflow'.length).trim();
            if (!commandText) {
                await reply(`@${actualUsername}, use !disableflow <!command>.`, 'broadcaster').catch(() => {});
                return;
            }

            try {
                const { setWorkflowEnabledByCommand } = await import('./automation/ai-workflow-builder');
                const updated = await setWorkflowEnabledByCommand(commandText, false, tenantId);
                await reply(`Disabled workflow for ${commandText}. Updated ${updated.linkedActions.length} linked action(s).`, 'broadcaster').catch(() => {});
            } catch (error: any) {
                console.error('[Dispatcher] !disableflow failed:', error);
                await reply(`@${actualUsername}, couldn't disable ${commandText}: ${error?.message || 'unknown error'}`, 'broadcaster').catch(() => {});
            }
            return;
        }

        if (actualMessage.toLowerCase().startsWith('!deleteflow')) {
            if (!tags.mod && !tags.badges?.broadcaster) {
                await reply(`@${actualUsername}, only mods can delete AI workflows from chat.`, 'broadcaster').catch(() => {});
                return;
            }

            const commandText = actualMessage.substring('!deleteflow'.length).trim();
            if (!commandText) {
                await reply(`@${actualUsername}, use !deleteflow <!command>.`, 'broadcaster').catch(() => {});
                return;
            }

            try {
                const { deleteWorkflowByCommand } = await import('./automation/ai-workflow-builder');
                const deleted = await deleteWorkflowByCommand(commandText, tenantId);
                await reply(`Deleted workflow for ${commandText}. Removed ${deleted.linkedActions.length} linked action(s).`, 'broadcaster').catch(() => {});
            } catch (error: any) {
                console.error('[Dispatcher] !deleteflow failed:', error);
                await reply(`@${actualUsername}, couldn't delete ${commandText}: ${error?.message || 'unknown error'}`, 'broadcaster').catch(() => {});
            }
            return;
        }
        
        // 1. Command Handling from JSON files
        console.log(`[Dispatcher] Looking for command: ${cmdName}`);
        const commands = await getAllCommands(tenantId);
        const configuredCommand = commands.find((c: any) => String(c.command || '').toLowerCase().replace(/^!/, '') === cmdName);
        
        const command = configuredCommand || commands.find((c: any) => String(c.command || '').toLowerCase().replace(/^!/, '') === cmdName && c.enabled);
        
        if (command) {
            console.log(`[Dispatcher] Found command: ${command.name}`);
            console.log(`[Dispatcher] Command has actionId:`, (command as any).actionId);
            console.log(`[Dispatcher] cmdName: ${cmdName}`);

            const cmdArgs = actualMessage.substring(cmdName.length + 2).trim().split(/\s+/).filter(Boolean);
            const targetRaw = cmdArgs[0]?.replace('@', '') || '';
            const execArgs: Record<string, any> = {};
            cmdArgs.forEach((a: string, i: number) => { execArgs[`input${i}`] = a; });
            execArgs.rawInput = cmdArgs.join(' ');
            execArgs.tenantId = tenantId || '';
            const executionContext = {
                user: actualUsername,
                userName: actualUsername,
                message: actualMessage,
                rawInput: cmdArgs.join(' '),
                platform: 'twitch',
                channel: replyChannel,
                tenantId: tenantId || undefined,
                args: execArgs,
                variables: {
                    user: actualUsername,
                    userName: actualUsername,
                    channel: replyChannel,
                    tenantId: tenantId || '',
                    targetUser: targetRaw,
                    targetUserName: targetRaw,
                    rawInput: cmdArgs.join(' '),
                },
            };

            const actionsForCommand = (await getAllActions(tenantId)).filter((action: any) =>
                action?.enabled &&
                Array.isArray(action.triggers) &&
                action.triggers.some((trigger: any) =>
                    trigger?.enabled !== false &&
                    Number(trigger?.type) === 401 &&
                    String(trigger?.commandId || '') === String((command as any).id || '')
                )
            );

            if (actionsForCommand.length > 0) {
                const { SubActionExecutor } = await import('./automation/SubActionExecutor');
                const executor = new SubActionExecutor();
                for (const action of actionsForCommand) {
                    console.log(`[Dispatcher] Executing command-triggered action ${action.id} for ${cmdName}`);
                    await executor.executeAction(action, executionContext);
                }
                return;
            }
            
            // Handle simple response
            if ((command as any).response && !(command as any).actionId && !(command as any).actions) {
                await reply((command as any).response, 'broadcaster').catch(() => {});
                return;
            }
            
            // Handle simple social commands (only if no actionId)
            if (!(command as any).actionId) {
                const socialCommands: Record<string, string> = {
                    'hug': '{user} wraps {target} in the cosmic warmth of love and understanding 🤗',
                    'boop': '{user} boops {target} on the nose! *boop* 👉',
                    'cuddle': '{user} cuddles up with {target} in a cozy embrace 🥰',
                    'dance': '{user} breaks out into a dance with {target}! 💃🕺',
                    'fistbump': '{user} gives {target} an epic fist bump! 👊',
                    'headpat': '{user} gently pats {target} on the head *pat pat* 🤚',
                    'highfive': '{user} high-fives {target}! ✋',
                    'love': '{user} sends love to {target}! ❤️',
                    'tickle': '{user} tickles {target}! *giggle* 😆',
                    'lurk': '{user} is lurking in the shadows 👀',
                    'unlurk': '{user} emerges from the shadows! Welcome back! 👋',
                    'hydrate': 'Time to hydrate! 💧 Stay healthy, chat!',
                    'stretch': 'Stretch break! 🤸 Take care of your body!',
                    'yes': 'Yes! ✅',
                    'yup': 'Yup! 👍',
                    'no': 'Nope! ❌',
                    'hover': '{user} hovers mysteriously 🛸',
                };
                
                if (socialCommands[cmdName]) {
                    const args = actualMessage.substring(cmdName.length + 2).trim();
                    const target = args || 'someone';
                    const response = socialCommands[cmdName]
                        .replace('{user}', actualUsername)
                        .replace('{target}', target);
                    await reply(response, 'bot').catch(() => {});
                    return;
                }
            }
            

            
            // Execute action if linked
            if ((command as any).actionId) {
                console.log(`[Dispatcher] Command has actionId: ${(command as any).actionId}`);
                const action = await getActionById((command as any).actionId, tenantId);
                console.log(`[Dispatcher] Action found:`, action ? 'YES' : 'NO');
                console.log(`[Dispatcher] Action object:`, JSON.stringify(action));
                if (action && (action as any).handler) {
                    const handler = (action as any).handler;
                    console.log(`[Dispatcher] Executing handler: ${handler}`);
                    
                    // Execute custom handlers
                    if (handler === 'pokemon-pack-open') {
                        const PACK_COST = 1000;
                        const userPoints = await getPointBalance(actualUsername);
                        
                        if (userPoints < BigInt(PACK_COST)) {
                            await reply(`@${actualUsername}, you need ${PACK_COST} points to open a pack! (You have ${userPoints.toString()})`, 'broadcaster').catch(() => {});
                            return;
                        }
                        
                        await addPoints(actualUsername, -PACK_COST);
                        
                        const { openPack } = require('./pokemon-packs');
                        const result = await openPack(1, actualUsername, undefined, tenantId);
                        if (result) {
                            const cardInfo = result.pack.map((c: any) => {
                              const isHolo = c.rarity && c.rarity.includes('Holo');
                              const isRare = c.rarity && c.rarity.includes('Rare');
                              const marker = isRare ? ' ✨' : (isHolo ? ' ⭐' : '');
                              return `${c.name} #${c.number}${marker}`;
                            }).join(', ');
                            
                            const { getUserCards } = require('./pokemon-collection');
                            const allCards = await getUserCards(actualUsername);
                            const rareCount = allCards.filter((c: any) => c.rarity && c.rarity.includes('Rare')).length;
                            
                            await reply(`@${actualUsername} opened a ${result.setName} pack and got: ${cardInfo} | Total: ${allCards.length} cards (${rareCount} rare)`, 'broadcaster').catch(() => {});
                        }
                    }
                } else if (action && action.subActions && action.subActions.length > 0) {
                    // Execute subActions using SubActionExecutor
                    const { SubActionExecutor } = await import('./automation/SubActionExecutor');
                    const executor = new SubActionExecutor();
                    await executor.executeAction(action, executionContext);
                }
            }
            
            if ((command as any).actions && (command as any).actions.length > 0) {
                const actionType = (command as any).actions[0].type;
                console.log(`[Dispatcher] Executing action type: ${actionType}`);
                
                if (actionType === 'commands-list-show') {
                    const response = 'Commands: !pack, !collection, !show <card>, !trade <user>, !offer <card>, !accept, !cancel, !challenge, !attack, !switch, !points, !gamble, !roll, !so <user>, !leader, !discord';
                    await reply(response, 'broadcaster').catch(() => {});
                } else if (actionType === 'pokemon-pack-open') {
                    const PACK_COST = 1000;
                    const userPoints = await getPointBalance(actualUsername);
                    
                    if (userPoints < BigInt(PACK_COST)) {
                        await reply(`@${actualUsername}, you need ${PACK_COST} points to open a pack! (You have ${userPoints.toString()})`, 'broadcaster').catch(() => {});
                        return;
                    }
                    
                    await addPoints(actualUsername, -PACK_COST);
                    
                    const { openPack } = require('./pokemon-packs');
                    const result = await openPack(1, actualUsername, undefined, tenantId);
                    if (result) {
                        const cardInfo = result.pack.map((c: any) => {
                          const isHolo = c.rarity && c.rarity.includes('Holo');
                          const isRare = c.rarity && c.rarity.includes('Rare');
                          const marker = isRare ? ' ✨' : (isHolo ? ' ⭐' : '');
                          return `${c.name} #${c.number}${marker}`;
                        }).join(', ');
                        
                        const { getUserCards } = require('./pokemon-collection');
                        const allCards = await getUserCards(actualUsername);
                        const rareCount = allCards.filter((c: any) => c.rarity && c.rarity.includes('Rare')).length;
                        
                        await reply(`@${actualUsername} opened a ${result.setName} pack and got: ${cardInfo} | Total: ${allCards.length} cards (${rareCount} rare)`, 'broadcaster').catch(() => {});
                    }
                } else if (actionType === 'pokemon-collection-show') {
                    const { getUserCards } = require('./pokemon-collection');
                    const cards = await getUserCards(actualUsername);
                    const rareCount = cards.filter((c: any) => c.rarity && c.rarity.includes('Rare')).length;
                    
                    // Create file and upload to Discord
                    const fileContent = cards.map((card: any) => {
                      return [
                        card.name,
                        `#${card.number}`,
                        `Set: ${card.setCode}`,
                        card.rarity || 'Common'
                      ].filter(Boolean).join(' | ');
                    }).join('\n');
                    
                    const { uploadFileToDiscord, deleteMessage, getChannelMessages } = require('./discord');
                    const STORAGE_CHANNEL_ID = '1476540488147533895';
                    const fileName = `collection_${actualUsername}_${Date.now()}.txt`;
                    
                    // Delete old collection files from this user
                    try {
                      const messages = await getChannelMessages(STORAGE_CHANNEL_ID, 50);
                      for (const msg of messages) {
                        if (msg.content?.includes(`${actualUsername}'s collection`) && msg.attachments?.length > 0) {
                          await deleteMessage(STORAGE_CHANNEL_ID, msg.id).catch(() => {});
                        }
                      }
                    } catch {}
                    
                    const result = await uploadFileToDiscord(
                      STORAGE_CHANNEL_ID,
                      fileContent,
                      fileName,
                      `${actualUsername}'s collection`
                    );
                    
                    let downloadUrl = '';
                    if (result && result.data && (result.data as any).attachments?.[0]?.url) {
                      downloadUrl = (result.data as any).attachments[0].url;
                    }
                    
                    await reply(`@${actualUsername} has ${cards.length} cards (${rareCount} rare). Download: ${downloadUrl}`, 'broadcaster').catch(() => {});
                    
                    // Show on overlay
                    if (typeof (global as any).broadcast === 'function') {
                      (global as any).broadcast({
                        type: 'pokemon-collection-show',
                        payload: { username: actualUsername, cards: cards.map((c: any) => `${c.setCode}-${c.number}`) }
                      }, tenantId);
                    }
                } else if (actionType === 'pokemon-trade-initiate') {
                    const args = actualMessage.substring(cmdName.length + 2).trim().split(/\s+/);
                    const targetUser = args[0]?.replace('@', '');
                    
                    if (!targetUser) {
                        await reply(`@${actualUsername}, usage: !trade @user`, 'bot').catch(() => {});
                        return;
                    }
                    
                    const { initiateTrade } = require('./pokemon-trade-manager');
                    await initiateTrade(actualUsername, targetUser, tenantId);
                }
            }
            return;
        }
    } else {
        // Points & Welcome Wagon (only for non-self messages to avoid awarding yourself points)
        if (!self && !isBot && !consumedByRedemption) {
            // Skip points and welcome for known bots
            const skipAsBot = await isKnownBot(actualUsername, tenantId);
            if (!skipAsBot) {
                const handledChatAutomation = await runChatAutomationTriggers();
                if (handledChatAutomation) {
                    return;
                }

                awardChatPoints(actualUsername, tenantCtx).catch(() => {});
            
                // Skip welcome wagon for broadcaster, bot, and messages from voice commands
                const skipWelcome = consumedByRedemption || tags.badges?.broadcaster || 
                                    actualUsername.toLowerCase() === (botUsername || '').toLowerCase() ||
                                    actualUsername.toLowerCase() === (broadcasterUsername || '').toLowerCase() ||
                                    message.includes('🌟');
            
                const welcomeKey = `${tenantId || '__global__'}:${actualUsername.toLowerCase()}`;
                if (skipWelcome) {
                    await recordShoutoutAudit({
                        status: 'skipped',
                        username: actualUsername,
                        displayName,
                        tenantId,
                        source: 'auto-welcome',
                        reason: tags.badges?.broadcaster ? 'broadcaster-message' : message.includes('🌟') ? 'voice-message' : 'bot-or-system-message',
                    });
                } else if (pendingWelcomeUsers.has(welcomeKey)) {
                    await recordShoutoutAudit({
                        status: 'skipped',
                        username: actualUsername,
                        displayName,
                        tenantId,
                        source: 'auto-welcome',
                        reason: 'already-pending',
                    });
                } else {
                    const welcomeEligibility = await getWelcomeEligibility(actualUsername, tenantId);
                    if (!welcomeEligibility.eligible) {
                        await recordShoutoutAudit({
                            status: 'skipped',
                            username: actualUsername,
                            displayName,
                            tenantId,
                            source: 'auto-welcome',
                            reason: welcomeEligibility.reason,
                        });
                    } else {
                        const welcomeMode = await getWelcomeMode(tenantId);

                        if (String(welcomeMode).toLowerCase() === 'off') {
                            // Welcome disabled — do nothing
                            await recordShoutoutAudit({
                                status: 'skipped',
                                username: actualUsername,
                                displayName,
                                tenantId,
                                source: 'auto-welcome',
                                reason: 'welcome-mode-off',
                            });
                        } else {
                            // Let handleWalkOnShoutout use greetingmode to decide behavior
                            const profileImage = `https://static-cdn.jtvnw.net/jtv_user_pictures/${actualUsername}-profile_image-300x300.png`;
                            pendingWelcomeUsers.add(welcomeKey);
                            await recordShoutoutAudit({
                                status: 'triggered',
                                username: actualUsername,
                                displayName,
                                tenantId,
                                source: 'auto-welcome',
                                metadata: { welcomeMode },
                            });
                            handleWalkOnShoutout(actualUsername, displayName, profileImage, false, tenantId, { source: 'auto-welcome' })
                                .then((completed) => {
                                    if (completed) {
                                        return markUserWelcomed(actualUsername, tenantId);
                                    }
                                    return recordShoutoutAudit({
                                        status: 'skipped',
                                        username: actualUsername,
                                        displayName,
                                        tenantId,
                                        source: 'auto-welcome',
                                        reason: 'handler-returned-false',
                                    });
                                })
                                .catch(err => {
                                    console.error('[Dispatcher] Walk-on shoutout failed:', err);
                                    recordShoutoutAudit({
                                        status: 'failed',
                                        username: actualUsername,
                                        displayName,
                                        tenantId,
                                        source: 'auto-welcome',
                                        error: auditError(err),
                                    }).catch(() => {});
                                    const { queueWalkOnRetry } = require('./walk-on-recovery');
                                    return queueWalkOnRetry({
                                        tenantId,
                                        username: actualUsername,
                                        displayName,
                                        profileImage,
                                        error: err,
                                    }).catch((queueErr: any) => {
                                        console.error('[Dispatcher] Failed to queue walk-on recovery:', queueErr);
                                    });
                                })
                                .finally(() => {
                                    pendingWelcomeUsers.delete(welcomeKey);
                                });
                        }
                    }
                }
            }
        }
        
        const userIsKnownBot = await isKnownBot(actualUsername, tenantId);
        const { getBotShareMode: checkBotShareMode } = require('../lib/bot-interactions-store');
        const botShareEnabled = userIsKnownBot && (await checkBotShareMode(tenantId)) === 'on';
        if (!isBot && !self && (!userIsKnownBot || botShareEnabled)) {
            const lowerMessage = actualMessage.toLowerCase();
            console.log(`[Dispatcher] Non-command message from ${actualUsername}, checking mentions. lowerMessage: "${lowerMessage.slice(0, 80)}"`);

            // Guardrail: in channels that are NOT the broadcaster's own channel,
            // Athena should only respond when the broadcaster themself is speaking.
            // Skip the guardrail entirely if broadcasterUsername was never resolved
            // (still the default 'broadcaster'); otherwise we would silently suppress
            // ALL bot mention responses, which is very hard to debug.
            const resolvedBroadcaster = (broadcasterUsername || '').toLowerCase();
            const hasResolvedBroadcaster = resolvedBroadcaster && resolvedBroadcaster !== 'broadcaster';
            if (hasResolvedBroadcaster) {
                const isOwnChannel = replyChannel.toLowerCase() === resolvedBroadcaster;
                const isBroadcasterSpeaker = actualUsername.toLowerCase() === resolvedBroadcaster;
                if (!isOwnChannel && !isBroadcasterSpeaker && !botShareEnabled) {
                    return;
                }
            } else {
                console.warn('[Dispatcher] broadcasterUsername unresolved (config/tokens unreadable); skipping foreign-channel guardrail for', { tenantId, replyChannel });
            }
            
            // Check for shoutout command (without bot name)
            // Skip messages that look like the formatted shoutout output to prevent re-triggering
            // Skip shoutout processing for known bots to prevent automated messages from triggering shoutouts
            const isShoutoutOutput = lowerMessage.includes('go check out') && lowerMessage.includes('twitch.tv/');
            if (!botShareEnabled && !isShoutoutOutput && (lowerMessage.includes('shout out') || lowerMessage.includes('shoutout'))) {
                console.log('[Dispatcher] Shoutout command detected');
                try {
                    const chattersResponse = await fetch(`http://127.0.0.1:${process.env.PORT||3100}/api/chat/chatters`);
                    let chatters = [];
                    if (chattersResponse.ok) {
                        const chattersData = await chattersResponse.json();
                        chatters = chattersData.chatters?.map((c: any) => c.user_display_name || c.user_login) || [];
                        console.log('[Dispatcher] Fetched chatters:', chatters.join(', '));
                    }
                    
                    const aiPrompt = `Voice command: "${actualMessage}"
Active chatters: ${chatters.join(', ')}

Find the best matching username from the chatters list and respond with ONLY the shoutout command in this format: !so @username

If no good match, respond with: Could not find matching user`;
                    
                    console.log('[Dispatcher] Calling AI generate for shoutout matching...');
                    const aiResponse = await fetch(`http://127.0.0.1:${process.env.PORT||3100}/api/ai/generate`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            prompt: aiPrompt,
                            temperature: 0.1,
                            maxOutputTokens: 50,
                        })
                    });
                    
                    console.log('[Dispatcher] AI generate response status:', aiResponse.status);
                    
                    if (aiResponse.ok) {
                        const aiData = await aiResponse.json();
                        const aiShoutoutReply = aiData?.text?.trim();
                        console.log('[Dispatcher] AI generate reply:', aiShoutoutReply);
                        
                        if (aiShoutoutReply && aiShoutoutReply.startsWith('!so @')) {
                            const targetName = aiShoutoutReply.substring(5).trim();
                            console.log(`[Dispatcher] AI matched shoutout target: ${targetName}`);
                            const profileImage = `https://static-cdn.jtvnw.net/jtv_user_pictures/${targetName}-profile_image-300x300.png`;
                            await handleWalkOnShoutout(targetName, targetName, profileImage, true, tenantId).catch(err => {
                            });
                        } else {
                            console.log('[Dispatcher] AI did not return valid shoutout command');
                            await replyMaybeKick('Could not find matching user in chat', 'bot').catch(() => {});

                        }
                    }
                } catch (error) {
                    console.error('[Dispatcher] AI shoutout matching failed:', error);
                }
                return;
            }
            
            const { getBotName, getBotInterests, getBotAliases } = require('../lib/bot-settings-store');
            let botName = getBotName(tenantId);
            let responseTenantId = tenantId;
            let responseBotName = botName;
            let athenaDenied = false;
            const explicitTwitchBotMentions = await getExplicitTwitchBotMentions(actualMessage);
            const firstLoreBot = await getFirstMentionedLoreBot(actualMessage);
            const localLoreBot = await getLoreCharacterForTenant(tenantId);
            const firstExplicitTwitchBot = explicitTwitchBotMentions[0];
            const firstLoreTenantId = firstLoreBot ? await resolveTenantForLoreBot(firstLoreBot, undefined) : undefined;
            const firstLoreIndex = getLoreCharacterFirstIndex(actualMessage, firstLoreBot);
            const shouldPreferExplicitTwitchBot = !!firstExplicitTwitchBot
                && (firstLoreIndex < 0 || firstExplicitTwitchBot.index <= firstLoreIndex);
            const routedExternalBot = shouldPreferExplicitTwitchBot ? firstExplicitTwitchBot?.character : firstLoreBot;
            const routedExternalTenantId = shouldPreferExplicitTwitchBot ? firstExplicitTwitchBot?.tenantId : firstLoreTenantId;

            if (routedExternalBot && routedExternalTenantId && routedExternalTenantId !== tenantId) {
                const isAthenaEverywhere = routedExternalBot.stableId === ATHENA_STABLE_ID;
                const canUseAthena = !isAthenaEverywhere || (
                    await getAthenaEverywhereMode() === 'on'
                    && await canRouteAthenaForUser({
                        username: actualUsername,
                        tenantId: ATHENA_WHITELIST_TENANT_ID,
                    })
                );
                if (canUseAthena) {
                    responseTenantId = routedExternalTenantId;
                    responseBotName = routedExternalBot.currentName;
                    botName = routedExternalBot.currentName;
                    console.log(`[Dispatcher] Cross-bot first mention routing "${actualMessage}" from #${replyChannel} to ${routedExternalBot.currentName} tenant ${routedExternalTenantId}`);
                } else if (isAthenaEverywhere) {
                    athenaDenied = true;
                    console.log(`[Dispatcher] Athena mention ignored for non-whitelisted user ${actualUsername} in #${replyChannel}`);
                }
            }
            const mentionTriggers = [
                `@${botUsername.toLowerCase()}`,
                botUsername.toLowerCase(),
                botName.toLowerCase(),
                `hey ${botName.toLowerCase()}`
            ].filter(Boolean);
            // Add pet names / aliases (e.g. "annie" for Athena)
            const petNames = (getBotAliases(responseTenantId) || '').toLowerCase().split(',').map((s: string) => s.trim()).filter(Boolean);
            console.log(`[Dispatcher] Loaded aliases for tenant ${responseTenantId}: [${petNames.join(', ')}]`);
            for (const alias of petNames) {
                mentionTriggers.push(alias);
                mentionTriggers.push(`hey ${alias}`);
            }
            console.log(`[Dispatcher] mentionTriggers for tenant ${tenantId}:`, mentionTriggers.join(', '));

            try {
                const { decideBotInteraction, appendBotInteraction } = await import('../lib/bot-interactions-store');
                const canUseAthenaInThisChat = await getAthenaEverywhereMode() === 'on'
                    && await canRouteAthenaForUser({
                        username: actualUsername,
                        tenantId: ATHENA_WHITELIST_TENANT_ID,
                    });
                const allowedTwitchParticipants = new Set<string>(explicitTwitchBotMentions.map((entry) => entry.character.stableId));
                if (localLoreBot?.stableId) allowedTwitchParticipants.add(localLoreBot.stableId);
                if (canUseAthenaInThisChat) allowedTwitchParticipants.add(ATHENA_STABLE_ID);
                const decision = await decideBotInteraction({
                    message: actualMessage,
                    currentBotName: responseBotName,
                    tenantId: responseTenantId,
                    platform: 'twitch',
                    additionalMentions: explicitTwitchBotMentions.map((entry) => ({
                        character: entry.character,
                        trigger: entry.trigger,
                    })),
                    allowedSpeakerStableIds: Array.from(allowedTwitchParticipants),
                    allowedTargetStableIds: Array.from(allowedTwitchParticipants),
                });

                if (decision?.shouldRespond) {
                    if (athenaDenied && decision.speaker.stableId === ATHENA_STABLE_ID) {
                        console.log(`[Dispatcher] Athena cross-bot response suppressed for non-whitelisted user ${actualUsername} in #${replyChannel}`);
                    } else {
                        console.log(`[Dispatcher] Cross-bot interaction triggered: ${decision.reason}`);
                        const response = await fetch(`http://127.0.0.1:${process.env.PORT||3100}/api/ai/chat-with-memory`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                username: actualUsername,
                                displayName: displayName,
                                message: decision.promptInstruction,
                                tenantId: responseTenantId || undefined,
                                context: 'twitch',
                            })
                        });

                        if (response.ok) {
                            const data = await response.json();
                            const aiReply = data.response?.trim() || data.data?.response?.trim() || '';
                            if (aiReply) {
                                await sendChatMessage(aiReply, 'bot', replyChannel, responseTenantId).catch(() => {});
                                await appendBotInteraction({
                                    platform: 'twitch',
                                    tenantId: responseTenantId,
                                    sourceUser: actualUsername,
                                    speakerBotId: decision.speaker.stableId,
                                    speakerBotName: decision.speaker.currentName,
                                    targetBotIds: decision.targets.map((target: any) => target.stableId),
                                    targetBotNames: decision.targets.map((target: any) => target.currentName),
                                    triggerMessage: actualMessage,
                                    responseMessage: aiReply,
                                }).catch(() => {});
                                await sendTwitchCrossBotFollowUp({
                                    channel: replyChannel,
                                    userName: actualUsername,
                                    triggerMessage: actualMessage,
                                    speakerName: decision.speaker.currentName,
                                    speakerStableId: decision.speaker.stableId,
                                    speakerTenantId: responseTenantId,
                                    speakerReply: aiReply,
                                    targets: decision.targets,
                                }).catch((error) => console.error('[Dispatcher] Twitch cross-bot follow-up failed:', error));
                                return;
                            }
                        }
                    }
                }
            } catch (err) {
                console.error('[Dispatcher] Cross-bot interaction failed:', err);
            }

            let mentionsBot = mentionTriggers.some(trigger => lowerMessage.includes(trigger));
            
            // Remove hardcoded Athena check - only use dynamic bot name
            if (mentionsBot) {
                console.log(`[Dispatcher] ${botName} mentioned by ${actualUsername}: ${actualMessage}`);
            } else {
                // Check if message contains bot interests (50% chance to respond)
                const botInterests = getBotInterests(tenantId) || '';
                if (botInterests && Math.random() < 0.5) {
                    const interests = botInterests.toLowerCase().split(',').map((i: string) => i.trim());
                    const hasInterest = interests.some((interest: string) => lowerMessage.includes(interest));
                    
                    if (hasInterest) {
                        console.log(`[Dispatcher] Interest detected in message from ${actualUsername}: ${actualMessage}`);
                        mentionsBot = true;
                    }
                }
            }
            
            if (mentionsBot) {
                
                incrementMetric('athenaCommands').catch(() => {});
                // Use chat-with-memory API for context-aware responses
                try {
                    console.log('[Dispatcher] Calling chat-with-memory API...');
                    
                    let messageToSend = actualMessage;
                    
                    const response = await fetch(`http://127.0.0.1:${process.env.PORT||3100}/api/ai/chat-with-memory`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            username: actualUsername,
                            message: messageToSend,
                            tenantId: responseTenantId || undefined,
                            context: message.includes('🌟') ? 'voice' : 'twitch',
                        })
                    });
                    
                    console.log('[Dispatcher] Chat-with-memory response status:', response.status);
                    
                    if (response.ok) {
                        const data = await response.json();
                        const aiReply = data.response?.trim() || '';
                        console.log('[Dispatcher] Chat-with-memory reply:', aiReply);
                        
                        if (aiReply) {
                            // Send the chat message
                            await sendChatMessage(aiReply, 'bot', replyChannel, responseTenantId).catch(() => {});
                            const shouldGenerateTtsForReply = !responseTenantId || responseTenantId === tenantId;
                            await sendTwitchCrossBotFollowUp({
                                channel: replyChannel,
                                userName: actualUsername,
                                triggerMessage: actualMessage,
                                speakerName: responseBotName,
                                speakerStableId: firstLoreBot?.stableId,
                                speakerTenantId: responseTenantId,
                                speakerReply: aiReply,
                                targets: [],
                            }).catch((error) => console.error('[Dispatcher] Twitch cross-bot follow-up failed:', error));
                            
                            // Generate TTS for AI response
                            if (shouldGenerateTtsForReply) {
                                try {
                                    const { textToSpeech } = await import('../ai/flows/text-to-speech');
                                    const ttsResult = await textToSpeech({ text: aiReply, tenantId: responseTenantId || undefined });
                                    
                                    if (ttsResult.audioDataUri) {
                                        const useTTSPlayer = process.env.USE_TTS_PLAYER !== 'false';
                                        
                                        if (useTTSPlayer) {
                                            const tenantQuery = tenantId ? `?tenant=${encodeURIComponent(tenantId)}` : '';
                                            await fetch(`http://127.0.0.1:${process.env.PORT||3100}/api/tts/current${tenantQuery}`, {
                                                method: 'POST',
                                                headers: { 'Content-Type': 'application/json' },
                                                body: JSON.stringify({ audioUrl: ttsResult.audioDataUri })
                                            }).catch(err => console.error('[Dispatcher] Failed to send TTS to player:', err));
                                        } else if (typeof (global as any).broadcast === 'function') {
                                            (global as any).broadcast({
                                                type: 'play-tts',
                                                payload: { audioDataUri: ttsResult.audioDataUri }
                                            }, tenantId);
                                        }
                                    }
                                } catch (err) {
                                    console.error('[Dispatcher] TTS generation failed for AI response:', err);
                                }
                            } else {
                                console.log(`[Dispatcher] Skipping TTS for cross-stream bot reply from tenant ${responseTenantId} in tenant ${tenantId || 'unknown'}.`);
                            }
                        }
                    } else {
                        const errorText = await response.text();
                        console.error('[Dispatcher] Chat-with-memory API error:', response.status, errorText);
                    }
                } catch (err) {
                    console.error(`[Dispatcher] ${botName} chat failed:`, err);
                }
            }
        }
    }
}

export async function handleDiscordMessage(msg: any, tenantId?: string, options: DiscordDispatchOptions = {}): Promise<{ commandHandled: boolean }> {
    const logChannelId = await getDiscordLogChannelId(tenantId);
    const sourceChannelId = msg.channelId || msg.channel_id || logChannelId;
    if (!sourceChannelId) return { commandHandled: false };

    const sourceUserName = msg.author?.username || msg.author?.globalName || msg.author?.global_name || 'Discord User';

    if (!options.skipPublicHistory && !msg.author?.bot && !msg.content.startsWith('[') && String(msg.content || '').trim()) {
        appendPublicChatMessages([{
            type: 'user',
            username: sourceUserName,
            message: String(msg.content),
            timestamp: new Date().toISOString(),
        }], 300, tenantId).catch(() => {});
    }

    if (/^!botshare(?:\s+(on|off|status))?$/i.test(msg.content.trim())) {
        const match = msg.content.trim().toLowerCase().match(/^!botshare(?:\s+(on|off|status))?$/);
        const action = match?.[1];
        try {
            const store = await import('../lib/bot-interactions-store');
            let mode;
            if (action === 'on' || action === 'off') {
                mode = await store.setBotShareMode(action, tenantId);
            } else if (action === 'status') {
                mode = await store.getBotShareMode(tenantId);
            } else {
                mode = await store.toggleBotShareMode(tenantId);
            }
            await sendDiscordMessage(
                sourceChannelId,
                `Bot share mode: ${String(mode).toUpperCase()} - cross-bot replies are ${mode === 'on' ? 'enabled' : 'disabled'}.`,
            ).catch((error) => console.error('[Discord Bridge] Failed to reply to !botshare:', error));
        } catch (error) {
            console.error('[Discord Bridge] !botshare command failed:', error);
        }
        return { commandHandled: true };
    }

    if (!msg.author?.bot) {
        const commandHandled = await executeDiscordCommandMessage({
            ...msg,
            channelId: sourceChannelId,
        }, tenantId);
        if (commandHandled) {
            if (!options.skipTwitchBridge) {
                await bridgeDiscordMessageToTwitch({
                    ...msg,
                    channelId: sourceChannelId,
                }, tenantId);
            }
            return { commandHandled: true };
        }
    }

    if (!options.skipAiMentions && !msg.content.startsWith('[') && msg.author && !msg.author.bot) {
        try {
            const { getBotName } = require('../lib/bot-settings-store');
            const { decideBotInteraction, appendBotInteraction } = await import('../lib/bot-interactions-store');
            const botName = getBotName(tenantId);
            const decision = await decideBotInteraction({
                message: msg.content,
                currentBotName: botName,
                tenantId,
                platform: 'discord',
            });

            if (decision?.shouldRespond) {
                    const response = await fetch(`http://127.0.0.1:${process.env.PORT||3100}/api/ai/chat-with-memory`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        username: msg.author?.username || sourceUserName,
                        userId: msg.author?.id || msg.author?.userId || undefined,
                        displayName: msg.author?.displayName || msg.author?.globalName || msg.author?.global_name || sourceUserName,
                        guildId: msg.guildId || msg.guild_id || undefined,
                        guildName: msg.guild?.name || msg.guild_name || undefined,
                        channelId: sourceChannelId,
                        channelName: msg.channel?.name || msg.channel_name || undefined,
                        channelType: msg.channel?.type || msg.channelType || msg.channel_type || undefined,
                        messageId: msg.id || msg.messageId || msg.message_id || undefined,
                        createdAt: msg.timestamp || msg.createdAt || msg.created_at || undefined,
                        isDirectMessage: Boolean(msg.isDM || msg.isDirectMessage || msg.is_direct_message),
                        message: decision.promptInstruction,
                        tenantId: tenantId || undefined,
                        context: 'discord',
                    })
                });

                if (response.ok) {
                    const data = await response.json();
                    const aiReply = data.response?.trim() || data.data?.response?.trim() || '';
                    if (aiReply) {
                        await sendDiscordMessage(sourceChannelId, aiReply).catch((error) => console.error('[Discord Bridge] Failed to send cross-bot reply:', error));
                        await appendBotInteraction({
                            platform: 'discord',
                            tenantId,
                            channelId: sourceChannelId,
                            sourceUser: sourceUserName,
                            speakerBotId: decision.speaker.stableId,
                            speakerBotName: decision.speaker.currentName,
                            targetBotIds: decision.targets.map((target: any) => target.stableId),
                            targetBotNames: decision.targets.map((target: any) => target.currentName),
                            triggerMessage: msg.content,
                            responseMessage: aiReply,
                        }).catch(() => {});
                        return { commandHandled: false };
                    }
                } else {
                    console.error('[Discord Bridge] Cross-bot AI failed:', response.status, await response.text().catch(() => ''));
                }
            }
        } catch (error) {
            console.error('[Discord Bridge] Cross-bot handling failed:', error);
        }
    }
    
    if (!options.skipTwitchBridge) {
        await bridgeDiscordMessageToTwitch({
            ...msg,
            channelId: sourceChannelId,
        }, tenantId);
    }

    return { commandHandled: false };
}
