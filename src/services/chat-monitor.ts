import { ChatHistoryMessage, DiscordMessage } from '../types/game-types';
import { LIMITS } from '../constants';
import * as fs from 'fs/promises';
import { resolve } from 'path';
import { handleDiscordMessage } from './chat-dispatcher';
import { tenantPath } from '../lib/tenant';
import { isDiscordApiError } from './discord-local';
import { readGenerationSettings } from '@/lib/gen-settings-store';
import { getConfiguredAppUrl, getInternalAppUrl } from '@/lib/runtime-origin';
import { buildDiscordBotEmbed } from './discord-branding';
import { getBotName } from '@/lib/bot-settings-store';
import { getProcessingOwner, pollOwns, type ProcessingArea } from './discord-processing-owner';
import { loadDmLastMessageId, saveDmLastMessageId } from './discord-dm-sweep-state';
import { registerHandledDiscordMessage } from './discord-message-dedupe';
import { shouldPollerDispatchDiscordMessage } from './discord-poller-filter';

let cachedChatHistory: Map<string, ChatHistoryMessage[]> = new Map();
let lastDiscordMessageId: Map<string, string | null> = new Map();
let sentToTwitchIds = new Set<string>();
let recentlySentMessages = new Set<string>();
let isLoadingHistory: Map<string, boolean> = new Map();
const lastMissingDiscordLogNotice = new Map<string, number>();
const lastPollDisabledNotice = new Map<string, number>();

const MAX_CHAT_HISTORY = LIMITS.MAX_CHAT_HISTORY; // Prevent unbounded growth
const MISSING_DISCORD_LOG_NOTICE_INTERVAL_MS = 10 * 60 * 1000;

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function logDedupeGate(area: ProcessingArea, action: 'allow' | 'skip', detail: Record<string, unknown>) {
    console.warn(`[DedupeGate] ${action.toUpperCase()} ${area} owner=${getProcessingOwner(area)}`, detail);
}

function maybeLogPollDisabled(key = 'global') {
    const now = Date.now();
    const lastNotice = lastPollDisabledNotice.get(key) || 0;
    if (now - lastNotice > MISSING_DISCORD_LOG_NOTICE_INTERVAL_MS) {
        console.warn('[DedupeGate] Public Discord poll dispatch disabled before Discord fetch', {
            publicCommandOwner: getProcessingOwner('public-command'),
            publicAiOwner: getProcessingOwner('public-ai'),
            reason: 'poll owns neither public-command nor public-ai',
        });
        lastPollDisabledNotice.set(key, now);
    }
}

function getPublicDiscordPollDecision(messageText: string): { allowed: boolean; area: ProcessingArea; reason: string } {
    const trimmed = String(messageText || '').trim();
    if (trimmed.startsWith('!')) {
        return { allowed: pollOwns('public-command'), area: 'public-command', reason: 'public Discord command dispatch' };
    }
    return { allowed: pollOwns('public-ai'), area: 'public-ai', reason: 'public Discord AI/mention dispatch' };
}

function isDiscordEmbeddableImageUrl(value: unknown): value is string {
    if (typeof value !== 'string') return false;
    const trimmed = value.trim();
    if (!trimmed || trimmed.length > 2048) return false;
    if (!/^https?:\/\//i.test(trimmed)) return false;
    try {
        const parsed = new URL(trimmed);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
        return false;
    }
}

async function maybeShortenUrl(url: string): Promise<string> {
    const trimmed = String(url || '').trim();
    if (!trimmed) return trimmed;
    if (trimmed.length <= 1900) return trimmed;
    if (!/^https?:\/\//i.test(trimmed)) return trimmed;
    try {
        const tinyRes = await fetch(`https://tinyurl.com/api-create.php?url=${encodeURIComponent(trimmed)}`);
        if (!tinyRes.ok) return trimmed;
        const tiny = (await tinyRes.text()).trim();
        if (!tiny || !/^https?:\/\//i.test(tiny)) return trimmed;
        return tiny;
    } catch {
        return trimmed;
    }
}

async function getDiscordChannelId(type: 'logChannelId' | 'aiChatChannelId' | 'shoutoutChannelId' | 'gameStateChannelId' | 'dmChannelId', tenantId?: string): Promise<string | null> {
    const SETTINGS_FILE = tenantId 
        ? tenantPath(tenantId, 'tokens/discord-channels.json')
        : resolve(process.cwd(), 'tokens', 'discord-channels.json');
    const LEGACY_SETTINGS_FILE = resolve(process.cwd(), 'src', 'data', 'discord-channels.json');
    
    try {
        const data = await fs.readFile(SETTINGS_FILE, 'utf-8');
        const settings = JSON.parse(data);
        return settings[type] || null;
    } catch {
        try {
            const legacyData = await fs.readFile(LEGACY_SETTINGS_FILE, 'utf-8');
            const settings = JSON.parse(legacyData);
            return settings[type] || null;
        } catch {
            return null;
        }
    }
}

export async function loadChatHistory(tenantId?: string): Promise<ChatHistoryMessage[]> {
    const key = tenantId || 'global';
    if (isLoadingHistory.get(key)) return cachedChatHistory.get(key) || [];
    isLoadingHistory.set(key, true);

    try {
        // console.log('[Discord] Checking DISCORD_BOT_TOKEN:', process.env.DISCORD_BOT_TOKEN ? 'set' : 'not set');
        if (!process.env.DISCORD_BOT_TOKEN || process.env.DISCORD_BOT_TOKEN.trim() === '') {
            console.log('[Discord] DISCORD_BOT_TOKEN not configured, skipping chat history load');
            return [];
        }

        const { getChannelMessages } = require('./discord');
        const logChannelId = await getDiscordChannelId('logChannelId', tenantId);

        if (!logChannelId) {
            const now = Date.now();
            const lastNotice = lastMissingDiscordLogNotice.get(key) || 0;
            if (now - lastNotice > MISSING_DISCORD_LOG_NOTICE_INTERVAL_MS) {
                console.log(`[Chat:${key}] No Discord log channel configured`);
                lastMissingDiscordLogNotice.set(key, now);
            }
            return [];
        }


        let messages;
        try {
            messages = await getChannelMessages(logChannelId, 50);
        } catch (error) {
            if (isDiscordApiError(error) && error.status === 404) {
                console.warn(`[Discord:${key}] Chat history channel is unavailable; continuing without history.`);
                return [];
            }
            if (isDiscordApiError(error) && error.status === 429) {
                const waitMs = Math.min(error.retryAfterMs ?? 2500, 10000);
                console.warn(`[Discord:${key}] Chat history rate limited; retrying after ${waitMs}ms.`);
                await delay(waitMs);
                try {
                    messages = await getChannelMessages(logChannelId, 50);
                } catch {
                    console.warn(`[Discord:${key}] Chat history still rate limited; continuing without history.`);
                    return [];
                }
            } else {
                console.warn(`[Discord:${key}] Chat history unavailable; continuing without it.`);
                return [];
            }
        }
        const chatHistory: ChatHistoryMessage[] = [];
        
        for (const msg of messages) {
            // Match both plain and markdown-formatted Twitch messages
            const twitchMatch = msg.content.match(/^(\d+\.\s*)?\*?\*?\[Twitch\]\s*(.*?):\*?\*?\s*(.*)$/s);
            if (twitchMatch) {
                chatHistory.push({
                    id: msg.id,
                    user: `[Twitch] ${twitchMatch[2]}`,
                    message: twitchMatch[3],
                    color: undefined,
                    badges: undefined,
                    isSystemMessage: false
                });
            } else if (!msg.content.match(/^\d*\.?\[/) && msg.author && !msg.author.bot) {
                // Process Discord message content to resolve mentions
                let processedContent = msg.content;
                
                // Replace user mentions with actual usernames
                if (msg.mentions && msg.mentions.users) {
                    for (const [userId, user] of msg.mentions.users) {
                        processedContent = processedContent.replace(new RegExp(`<@!?${userId}>`, 'g'), `@${user.username}`);
                    }
                }
                
                // Replace custom emojis
                processedContent = processedContent.replace(/<:(\w+):(\d+)>/g, ':$1:');
                
                chatHistory.push({
                    id: msg.id,
                    user: `[Discord] ${msg.author.username}`,
                    message: processedContent,
                    color: '#5865F2',
                    badges: { discord: '1' },
                    isSystemMessage: false
                });
            }
        }
        
        chatHistory.reverse();
        // Limit chat history size to prevent memory issues
        if (chatHistory.length > MAX_CHAT_HISTORY) {
            chatHistory.splice(0, chatHistory.length - MAX_CHAT_HISTORY);
        }
        cachedChatHistory.set(key, chatHistory);
        
        if (messages.length > 0) {
            lastDiscordMessageId.set(key, messages[0].id);
        }
        


        // Broadcast history to connected clients so the UI updates
        if (typeof (global as any).broadcast === 'function') {
            (global as any).broadcast({
                type: 'chat-history',
                payload: chatHistory
            }, tenantId);
        }
        return chatHistory;
    } catch (error) {
        console.warn(`Discord chat history unavailable for ${key}; continuing without it.`);
        return [];
    } finally {
        isLoadingHistory.set(key, false);
    }
}

export async function checkChatActivity() {
    try {
        if (!pollOwns('public-command') && !pollOwns('public-ai')) {
            maybeLogPollDisabled('global');
            return;
        }

        const logChannelId = await getDiscordChannelId('logChannelId');
        
        if (!logChannelId) {
            return; // No channel configured, skip silently
        }
        
        const { getChannelMessages } = require('./discord');
        let messages;
        try {
            messages = await getChannelMessages(logChannelId, 10);
        } catch (error) {
            console.warn('[ChatMonitor] Failed to fetch Discord public chat activity:', error);
            return;
        }

        if (!messages || messages.length === 0) return;

        const globalKey = 'global';

        // If we don't have a baseline (first run), set it to the latest message and stop.
        if (!lastDiscordMessageId.has(globalKey)) {
            lastDiscordMessageId.set(globalKey, messages[0].id);
            return;
        }

        const lastId = lastDiscordMessageId.get(globalKey);
        const newMessages = [];
        for (const msg of messages) {
            if (msg.id === lastId) break;
            newMessages.push(msg);
        }
        
        // Process duplicate-prone public Discord work once, according to the configured owner.
        for (const msg of newMessages.reverse()) {
            if (shouldPollerDispatchDiscordMessage(msg.content, {
                username: msg.author?.username || msg.author?.global_name || msg.author?.globalName,
                channelId: msg.channel_id || logChannelId,
            }) && msg.author && !msg.author.bot && !sentToTwitchIds.has(msg.id)) {
                const decision = getPublicDiscordPollDecision(msg.content);
                const detail = {
                    messageId: msg.id,
                    author: msg.author?.username || msg.author?.global_name || msg.author?.globalName || 'unknown',
                    preview: String(msg.content || '').slice(0, 120),
                    reason: decision.reason,
                };

                if (!decision.allowed) {
                    logDedupeGate(decision.area, 'skip', detail);
                    sentToTwitchIds.add(msg.id);
                    continue;
                }

                logDedupeGate(decision.area, 'allow', detail);
                if (!registerHandledDiscordMessage({
                    messageId: msg.id,
                    channelId: msg.channel_id || logChannelId,
                    userId: msg.author?.id,
                    username: msg.author?.username || msg.author?.global_name || msg.author?.globalName,
                    content: msg.content,
                    createdAt: msg.timestamp || msg.createdAt || msg.created_at,
                })) {
                    continue;
                }
                await handleDiscordMessage(msg);
                sentToTwitchIds.add(msg.id);
            }
        }
        
        if (messages.length > 0 && messages[0].id !== lastId) {
            lastDiscordMessageId.set(globalKey, messages[0].id);
        }

        // Prune sentToTwitchIds to prevent unbounded memory growth
        if (sentToTwitchIds.size > 500) {
            const idsArray = Array.from(sentToTwitchIds);
            sentToTwitchIds = new Set(idsArray.slice(idsArray.length - 200));
        }
        
    } catch (error) {
        console.warn('[ChatMonitor] checkChatActivity failed:', error);
    }
}



export async function checkDmChannelActivity(): Promise<void> {
    if (!process.env.DISCORD_BOT_TOKEN || process.env.DISCORD_BOT_TOKEN.trim() === '') return;
    const { listTenants } = await import('../lib/tenant');
    const { getChannelMessages } = require('./discord');
    const { sendDiscordMessage, sendDiscordEmbed } = require('./discord-local');
    const { getGenMode, setGenMode, toggleGenMode } = await import('../lib/gen-mode-store');

    for (const tenantId of await listTenants()) {
        const dmChannelId = await getDiscordChannelId('dmChannelId', tenantId);
        if (!dmChannelId || !dmChannelId.trim()) continue;

        const stateKey = `dm:${tenantId}`;
        if (!lastDiscordMessageId.has(stateKey)) {
            const saved = await loadDmLastMessageId(tenantId);
            lastDiscordMessageId.set(stateKey, saved);
        }

        let messages: any[] = [];
        try {
            messages = await getChannelMessages(dmChannelId, 20);
        } catch {
            continue;
        }
        if (!messages?.length) continue;

        const lastId = lastDiscordMessageId.get(stateKey);
        if (!lastId) {
            // First-run bootstrap: don't silently drop a fresh command message.
            // If the newest message is user-authored and looks like a DM command,
            // process it once before establishing baseline.
            const newest = messages[0];
            if (newest?.content && !newest?.author?.bot) {
                const newestText = String(newest.content).trim();
                if (newestText.toLowerCase() === '!img' || newestText.toLowerCase().startsWith('!img ')) {
                    console.log(`[DM Sweep:${tenantId}] First-run processing newest !img command:`, newestText.slice(0, 120));
                    const prompt = newestText.replace(/^!img\s*/i, '').trim();
                    if (!prompt) {
                        const baseUrl = getConfiguredAppUrl();
                        const libraryUrl = `${baseUrl}/api/ai/image/library?tenantId=${encodeURIComponent(tenantId)}`;
                        await sendDiscordMessage(dmChannelId, `Usage: !img <description>\nImage library: ${libraryUrl}`);
                    } else {
                        try {
                            await sendDiscordMessage(dmChannelId, "I'm processing your image now, Commander.");
                    const genDefaults = await readGenerationSettings(tenantId);
                    const imageRes = await fetch(`${getInternalAppUrl()}/api/ai/image`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
            prompt,
            tenantId,
            model: genDefaults.model || undefined,
            resolution: genDefaults.resolution || undefined,
            numImages: genDefaults.imageCount || 1,
            providerParams: {
              lora: genDefaults.lora || undefined,
              loraStrength: genDefaults.loraStrength,
              steps: genDefaults.steps,
              cfg: genDefaults.cfg,
              seed: genDefaults.seed,
            },
          }),
                            });
                            if (!imageRes.ok) {
                                const errText = await imageRes.text().catch(() => '');
                                console.warn(`[DM Sweep:${tenantId}] !img failed:`, imageRes.status, errText.slice(0, 200));
                                await sendDiscordMessage(dmChannelId, 'Image generation failed. Try again in a moment.');
                            } else {
                                const imageData = await imageRes.json();
                                const imageUrl = imageData?.image || imageData?.imageResourceUrl || imageData?.data?.image || '';
                                if (imageUrl) {
                                    await sendDiscordMessage(dmChannelId, imageUrl);
                                } else {
                                    await sendDiscordMessage(dmChannelId, 'Image generation returned no image URL.');
                                }
                            }
                        } catch (error) {
                            console.warn(`[DM Sweep:${tenantId}] !img exception:`, error);
                        }
                    }
                }
            }

            lastDiscordMessageId.set(stateKey, messages[0].id);
            await saveDmLastMessageId(tenantId, messages[0].id);
            continue;
        }

        const newMessages: any[] = [];
        for (const msg of messages) {
            if (msg.id === lastId) break;
            newMessages.push(msg);
        }

        for (const msg of newMessages.reverse()) {
            if (!msg?.content || msg?.author?.bot) continue;
            const messageText = String(msg.content || '').trim();
            try {
                if (messageText.toLowerCase() === '!img' || messageText.toLowerCase().startsWith('!img ')) {
                    const prompt = messageText.replace(/^!img\s*/i, '').trim();
                    if (!prompt) {
                        const baseUrl = getConfiguredAppUrl();
                        const libraryUrl = `${baseUrl}/api/ai/image/library?tenantId=${encodeURIComponent(tenantId)}`;
                        await sendDiscordMessage(dmChannelId, `Usage: !img <description>\nImage library: ${libraryUrl}`);
                        continue;
                    }
                    await sendDiscordMessage(dmChannelId, "I'm processing your image now, Commander.");
                    const genDefaults = await readGenerationSettings(tenantId);
                    const imageRes = await fetch(`${getInternalAppUrl()}/api/ai/image`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
            prompt,
            tenantId,
            model: genDefaults.model || undefined,
            resolution: genDefaults.resolution || undefined,
            numImages: genDefaults.imageCount || 1,
            providerParams: {
              lora: genDefaults.lora || undefined,
              loraStrength: genDefaults.loraStrength,
              steps: genDefaults.steps,
              cfg: genDefaults.cfg,
              seed: genDefaults.seed,
            },
          }),
                    });
                    if (!imageRes.ok) {
                        const errText = await imageRes.text().catch(() => '');
                        console.warn(`[DM Sweep:${tenantId}] !img failed:`, imageRes.status, errText.slice(0, 400));
                        await sendDiscordMessage(dmChannelId, 'Image generation failed. Try again in a moment.');
                        continue;
                    }
                    const imageData = await imageRes.json();
                    const rawImageUrl = imageData?.image || imageData?.imageResourceUrl || imageData?.data?.image || '';
                    if (!rawImageUrl) {
                        console.warn(`[DM Sweep:${tenantId}] !img returned empty image payload:`, JSON.stringify(imageData).slice(0, 400));
                        await sendDiscordMessage(dmChannelId, 'Image generation returned no image URL.');
                        continue;
                    }
                    const imageUrl = await maybeShortenUrl(String(rawImageUrl).trim());
                    const embeddableImageUrl = isDiscordEmbeddableImageUrl(imageUrl) ? imageUrl : null;
                    const baseUrl = getConfiguredAppUrl();
                    const ttsUrl = `${baseUrl}/tts/player?tenantId=${encodeURIComponent(tenantId)}&text=${encodeURIComponent(prompt.slice(0, 500))}`;
                    if (embeddableImageUrl) {
                        const embed = await buildDiscordBotEmbed({
                            description: prompt,
                            tenantId,
                            authorUrl: ttsUrl,
                            authorName: getBotName(tenantId),
                        });
                        await sendDiscordEmbed(dmChannelId, {
                            embeds: [{
                                ...embed,
                                title: '🎨 Image Generated',
                                image: { url: embeddableImageUrl },
                            }],
                        });
                    } else {
                        console.warn(`[DM Sweep:${tenantId}] !img returned non-embeddable URL (len=${imageUrl.length}); sending link only.`);
                        await sendDiscordMessage(dmChannelId, imageUrl).catch(() => {});
                    }
                    continue;
                }
                const genModeMatch = messageText.match(/^!genmode(?:\s+(eden|seaart|perchance|status))?$/i);
                if (genModeMatch) {
                    const action = (genModeMatch[1] || '').toLowerCase();
                    const mode = action === 'eden' || action === 'seaart' || action === 'perchance'
                        ? await setGenMode(action, tenantId)
                        : action === 'status'
                            ? await getGenMode(tenantId)
                            : await toggleGenMode(tenantId);
                    await sendDiscordMessage(dmChannelId, `Generation mode: ${String(mode).toUpperCase()}`);
                    continue;
                }

                const res = await fetch(`${getInternalAppUrl()}/api/private-chat/respond`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        username: msg.author?.global_name || msg.author?.username || 'DiscordUser',
                        message: msg.content,
                        tenantId,
                        historyLimit: 30,
                    }),
                });
                if (!res.ok) continue;
                const data = await res.json();
                const reply = data.response || data.data?.response || '';
                if (!reply) continue;

                const baseUrl = getConfiguredAppUrl();
                const ttsUrl = `${baseUrl}/tts/player?tenantId=${encodeURIComponent(tenantId)}&text=${encodeURIComponent(reply.slice(0, 500))}`;
                await sendDiscordEmbed(dmChannelId, {
                    embeds: [await buildDiscordBotEmbed({
                        description: reply,
                        tenantId,
                        authorUrl: ttsUrl,
                        authorName: getBotName(tenantId),
                    })],
                });
            } catch (error) {
                console.warn(`[DM Sweep:${tenantId}] Failed to process DM message`, error);
            }
        }

        if (messages[0]?.id && messages[0].id !== lastId) {
            lastDiscordMessageId.set(stateKey, messages[0].id);
            await saveDmLastMessageId(tenantId, messages[0].id);
        }
    }
}

export function getCachedChatHistory(tenantId?: string): ChatHistoryMessage[] {
    const key = tenantId || 'global';
    return cachedChatHistory.get(key) || [];
}
