import { ChatHistoryMessage, DiscordMessage } from '../types/game-types';
import { LIMITS } from '../constants';
import * as fs from 'fs/promises';
import { resolve } from 'path';
import { isDiscordApiError } from './discord-local';
import { readDiscordConfig } from '@/lib/discord-config';
import { readGenerationSettings } from '@/lib/gen-settings-store';
import { getConfiguredAppUrl, getInternalAppUrl } from '@/lib/runtime-origin';
import { sendStructuredDiscordReply } from './discord-structured-replies';
import { loadDmLastMessageId, saveDmLastMessageId } from './discord-dm-sweep-state';
import { runImageCommand } from './image-command';
import { queueTtsOverlay } from './tts-overlay-queue';
import { appendPrivateChatMessages } from '@/lib/private-chat-store';
import { readPrivateChatSettings } from '@/lib/private-chat-settings-store';
import { internalServiceHeaders } from '@/lib/internal-service-auth';
import { pollOwns } from './discord-processing-owner';
import { resolvePrivateDiscordTenant } from './private-discord-tenant';

let cachedChatHistory: Map<string, ChatHistoryMessage[]> = new Map();
let lastDiscordMessageId: Map<string, string | null> = new Map();
let recentlySentMessages = new Set<string>();
let isLoadingHistory: Map<string, boolean> = new Map();
const lastMissingDiscordLogNotice = new Map<string, number>();
let isCheckingDmChannelActivity = false;

const MAX_CHAT_HISTORY = LIMITS.MAX_CHAT_HISTORY; // Prevent unbounded growth
const MISSING_DISCORD_LOG_NOTICE_INTERVAL_MS = 10 * 60 * 1000;

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function normalizeDiscordAttachmentsForMemory(msg: any) {
    const values = Array.isArray(msg?.attachments)
        ? msg.attachments
        : msg?.attachments?.values
            ? Array.from(msg.attachments.values())
            : [];
    return values
        .map((attachment: any) => ({
            id: String(attachment?.id || attachment?.url || attachment?.proxy_url || ''),
            filename: String(attachment?.filename || attachment?.name || 'attachment'),
            url: attachment?.url || attachment?.proxy_url || '',
            proxy_url: attachment?.proxy_url || undefined,
            content_type: attachment?.content_type || attachment?.contentType || undefined,
            width: typeof attachment?.width === 'number' ? attachment.width : undefined,
            height: typeof attachment?.height === 'number' ? attachment.height : undefined,
            size: typeof attachment?.size === 'number' ? attachment.size : undefined,
        }))
        .filter((attachment: { url: string }) => attachment.url);
}

function normalizeDiscordEmbedsForMemory(msg: any) {
    const values = Array.isArray(msg?.embeds) ? msg.embeds : [];
    return values
        .map((embed: any) => ({
            title: typeof embed?.title === 'string' ? embed.title : undefined,
            description: typeof embed?.description === 'string' ? embed.description : undefined,
            url: typeof embed?.url === 'string' ? embed.url : undefined,
            image: embed?.image?.url ? { url: String(embed.image.url) } : undefined,
            thumbnail: embed?.thumbnail?.url ? { url: String(embed.thumbnail.url) } : undefined,
            video: embed?.video?.url ? { url: String(embed.video.url) } : undefined,
            type: typeof embed?.type === 'string' ? embed.type : undefined,
        }))
        .filter((embed: { title?: string; description?: string; url?: string; image?: { url: string }; thumbnail?: { url: string }; video?: { url: string } }) => embed.title || embed.description || embed.url || embed.image || embed.thumbnail || embed.video);
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
    if (!tenantId) return null;

    try {
        const settings = await readDiscordConfig(tenantId) as Record<string, any>;
        return settings[type] || null;
    } catch {
        return null;
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
    return;
}



export async function checkDmChannelActivity(): Promise<void> {
    if (!pollOwns('dm-private-ai')) return;
    // !img is now handled by /api/discord/chat route directly.
    // DM sweep only handles conversational AI responses, not commands.
    if (!process.env.DISCORD_BOT_TOKEN || process.env.DISCORD_BOT_TOKEN.trim() === '') return;
    if (isCheckingDmChannelActivity) return;
    isCheckingDmChannelActivity = true;
    const { listTenants } = await import('../lib/tenant');
    const { getChannelMessages } = require('./discord');
    const { sendDiscordMessage } = require('./discord-local');
    const { getGenMode, setGenMode, toggleGenMode } = await import('../lib/gen-mode-store');

    try {
        const processedDmChannels = new Set<string>();
        for (const tenantId of await listTenants()) {
        const dmChannelId = await getDiscordChannelId('dmChannelId', tenantId);
        if (!dmChannelId || !dmChannelId.trim()) continue;
        const normalizedDmChannelId = dmChannelId.trim();
        if (processedDmChannels.has(normalizedDmChannelId)) {
            console.warn(`[DM Sweep:${tenantId}] Skipping duplicate DM channel ${normalizedDmChannelId}`);
            continue;
        }
        processedDmChannels.add(normalizedDmChannelId);

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
            if (msg?.author?.bot) continue;

            // PRIVATE DATA BOUNDARY: a configured DM channel is not sufficient
            // proof of tenant ownership. Verify the exact Discord message and
            // immutable author ID, then require it to resolve back to this loop's
            // tenant before touching private history or private settings.
            const verifiedPrivateTenant = await resolvePrivateDiscordTenant({
                discordUserId: msg.author?.id,
                discordUsername: msg.author?.username,
                channelId: normalizedDmChannelId,
                messageId: msg.id,
            });
            if (!verifiedPrivateTenant || verifiedPrivateTenant.tenantId !== tenantId) {
                console.error('[DM Sweep] Refusing private message with mismatched tenant ownership', {
                    configuredTenantId: tenantId,
                    verifiedTenantId: verifiedPrivateTenant?.tenantId || null,
                    channelId: normalizedDmChannelId,
                    messageId: msg.id || null,
                    discordUserId: msg.author?.id || null,
                });
                continue;
            }

            const messageText = String(msg?.content || '').trim();
            const memoryAttachments = normalizeDiscordAttachmentsForMemory(msg);
            const memoryEmbeds = normalizeDiscordEmbedsForMemory(msg);
            const hasMemoryMedia = memoryAttachments.length > 0 || memoryEmbeds.length > 0;
            if (!messageText && !hasMemoryMedia) continue;
            try {
                if (msg.id) {
                    lastDiscordMessageId.set(stateKey, msg.id);
                    await saveDmLastMessageId(tenantId, msg.id);
                }
                // DMs may arrive only through this sweep, so command-like DMs
                // must be forwarded into the canonical Discord route.
                if (messageText.startsWith('!')) {
                    const routeRes = await fetch(`${getInternalAppUrl()}/api/discord/chat`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            tenantId,
                            isDM: true,
                            isDirectMessage: true,
                            channelId: dmChannelId,
                            channel_id: dmChannelId,
                            channelType: 'DM',
                            messageId: msg.id,
                            message_id: msg.id,
                            createdAt: msg.timestamp || msg.createdAt,
                            created_at: msg.timestamp || msg.createdAt,
                            userId: msg.author?.id,
                            user_id: msg.author?.id,
                            username: msg.author?.username,
                            userName: msg.author?.username,
                            displayName: msg.author?.global_name || msg.author?.globalName || msg.author?.username,
                            content: messageText,
                            message: messageText,
                            author: msg.author,
                            mentions: msg.mentions,
                            attachments: msg.attachments,
                            embeds: msg.embeds,
                            dispatch: false,
                        }),
                    });
                    if (!routeRes.ok) {
                        console.warn(`[DM Sweep:${tenantId}] Discord route command handoff failed:`, routeRes.status, await routeRes.text().catch(() => ''));
                    }
                    continue;
                }

                if (!messageText) {
                    await appendPrivateChatMessages([{
                        type: 'user',
                        username: msg.author?.global_name || msg.author?.username || 'DiscordUser',
                        message: '',
                        timestamp: new Date().toISOString(),
                        ...(memoryAttachments.length ? { attachments: memoryAttachments } : {}),
                        ...(memoryEmbeds.length ? { embeds: memoryEmbeds } : {}),
                    }], 100, tenantId);
                    continue;
                }

                const res = await fetch(`${getInternalAppUrl()}/api/private-chat/respond`, {
                    method: 'POST',
                    headers: internalServiceHeaders({ 'Content-Type': 'application/json' }),
                    body: JSON.stringify({
                        username: msg.author?.global_name || msg.author?.username || 'DiscordUser',
                        message: messageText,
                        attachments: memoryAttachments,
                        embeds: memoryEmbeds,
                        tenantId,
                        historyLimit: 30,
                    }),
                });
                if (!res.ok) continue;
                const data = await res.json();
                const reply = data.response || data.data?.response || '';
                if (!reply) continue;

                await queueTtsOverlay(reply, tenantId).then((result) => {
                    if (!result.ok) console.warn(`[DM Sweep:${tenantId || 'global'}] TTS overlay queue failed:`, result.error);
                });
                const requester = msg.author?.global_name || msg.author?.globalName || msg.author?.username || 'DiscordUser';
                const privateSettings = await readPrivateChatSettings(tenantId).catch(() => null);
                await sendStructuredDiscordReply({
                    channelId: dmChannelId,
                    message: reply,
                    tenantId,
                    responseType: 'AI Answer',
                    sourceMessageId: msg.id,
                    sourceMessage: messageText,
                    sourceUser: requester,
                    sourceUserAvatarUrl: msg.author?.avatarUrl || msg.author?.displayAvatarURL,
                    isPrivate: true,
                    gifEnabled: privateSettings?.gifEnabled !== false,
                    ttsEnabled: privateSettings?.ttsEnabled === true,
                    adultMode: privateSettings?.adultMode === true,
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
    } finally {
        isCheckingDmChannelActivity = false;
    }
}

export function getCachedChatHistory(tenantId?: string): ChatHistoryMessage[] {
    const key = tenantId || 'global';
    return cachedChatHistory.get(key) || [];
}
