import { ChatHistoryMessage, DiscordMessage } from '../types/game-types';
import { LIMITS } from '../constants';
import * as fs from 'fs/promises';
import { resolve } from 'path';
import { handleDiscordMessage } from './chat-dispatcher';
import { tenantPath } from '../lib/tenant';
import { isDiscordApiError } from './discord-local';

let cachedChatHistory: Map<string, ChatHistoryMessage[]> = new Map();
let lastDiscordMessageId: Map<string, string | null> = new Map();
let sentToTwitchIds = new Set<string>();
let recentlySentMessages = new Set<string>();
let isLoadingHistory: Map<string, boolean> = new Map();

const MAX_CHAT_HISTORY = LIMITS.MAX_CHAT_HISTORY; // Prevent unbounded growth

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function getDiscordChannelId(type: 'logChannelId' | 'aiChatChannelId' | 'shoutoutChannelId' | 'gameStateChannelId', tenantId?: string): Promise<string | null> {
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
            console.log(`[Chat:${key}] No Discord log channel configured`);
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
        const logChannelId = await getDiscordChannelId('logChannelId');
        
        if (!logChannelId) {
            return; // No channel configured, skip silently
        }
        
        const { getChannelMessages } = require('./discord');
        let messages;
        try {
            messages = await getChannelMessages(logChannelId, 10);
        } catch (error) {
            // Silently handle errors to prevent spam
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
        
        // Process Discord → Twitch bridging
        for (const msg of newMessages.reverse()) {
            if (!msg.content.startsWith('[') && msg.author && !msg.author.bot && !sentToTwitchIds.has(msg.id)) {
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
        // Silently handle errors to prevent spam
    }
}

export function getCachedChatHistory(tenantId?: string): ChatHistoryMessage[] {
    const key = tenantId || 'global';
    return cachedChatHistory.get(key) || [];
}
