import * as tmi from 'tmi.js';
import { getStoredTokens, ensureValidToken } from '../lib/token-utils.server';
import { getUserTokens } from '../lib/firestore';
import type { StoredTokens } from '../lib/token-utils.server';
import * as fs from 'fs/promises';
import { resolve } from 'path';
import { sendDiscordMessage } from './discord';
import { awardChatPoints } from './points';
import { shouldWelcomeUser, markUserWelcomed } from './welcome-wagon-memory';
import { handleTwitchMessage } from './chat-dispatcher';

let broadcasterClient: tmi.Client | null = null;
let botClient: tmi.Client | null = null;
let twitchStatus: 'connected' | 'disconnected' | 'connecting' = 'connecting';
let warnedMissingBotAuth = false;
let isRetryPending = false;
let connectionAttempts = 0;
const MAX_RETRY_ATTEMPTS = 3;

function scheduleRetry(userId?: string) {
    if (isRetryPending) return;
    isRetryPending = true;
    console.log('[Twitch] Will retry setup in 5 seconds...');
    setTimeout(() => {
        isRetryPending = false;
        setupTwitchClient(userId).catch(e => console.error('[Twitch] Retry attempt failed:', e));
    }, 5000);
}

async function getDiscordLogChannelId(): Promise<string | null> {
    const paths = [
        resolve(process.cwd(), 'tokens', 'discord-channels.json'),
        resolve(process.cwd(), 'src', 'data', 'discord-channels.json')
    ];

    for (const p of paths) {
        try {
            const data = await fs.readFile(p, 'utf-8');
            const settings = JSON.parse(data);
            if (settings.logChannelId) return settings.logChannelId;
        } catch {}
    }
    return null;
}

let isSetupInProgress = false;

export async function setupTwitchClient(userId?: string) {
    if (isSetupInProgress) {
        console.log('[Twitch] Setup already in progress, skipping...');
        return;
    }
    
    isSetupInProgress = true;
    console.log('[Twitch] Starting Twitch chat client setup...');
    const clientId = process.env.TWITCH_CLIENT_ID;
    const clientSecret = process.env.TWITCH_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
        console.error('[Twitch] Client credentials not configured (TWITCH_CLIENT_ID or TWITCH_CLIENT_SECRET missing).');
        twitchStatus = 'disconnected';
        scheduleRetry(userId);
        return;
    }

    try {
        let tokens: StoredTokens | null = null;
        if (userId) {
            tokens = await getUserTokens(userId);
        } else {
            tokens = await getStoredTokens();
        }

        if (!tokens) {
            console.error('[Twitch] No tokens available. Please authenticate via the dashboard.');
            twitchStatus = 'disconnected';
            isSetupInProgress = false;
            scheduleRetry(userId);
            return;
        }

        const broadcasterUsername = tokens.broadcasterUsername;
        const botUsername = tokens.botUsername;
        const hasBotToken = tokens.botToken && tokens.botRefreshToken;
        
        console.log(`[Twitch] Setting up clients - Broadcaster: ${broadcasterUsername}, Bot: ${botUsername || 'none'}`);
        
        // Validate tokens
        const broadcasterOauthToken = await ensureValidToken(clientId, clientSecret, 'broadcaster', tokens);
        
        if (!broadcasterUsername || !broadcasterOauthToken) {
            console.error('[Twitch] Missing broadcaster credentials.');
            twitchStatus = 'disconnected';
            isSetupInProgress = false;
            scheduleRetry(userId);
            return;
        }

        // Disconnect existing clients first
        if (botClient) {
            console.log('[Twitch] Destroying existing bot client');
            try {
                botClient.removeAllListeners();
                await botClient.disconnect();
            } catch (e) { /* ignore */ }
            botClient = null;
        }
        if (broadcasterClient) {
            console.log('[Twitch] Destroying existing broadcaster client');
            try {
                broadcasterClient.removeAllListeners();
                await broadcasterClient.disconnect();
            } catch (e) { /* ignore */ }
            broadcasterClient = null;
        }

        // Setup bot client if credentials exist
        if (botUsername && hasBotToken) {
            console.log(`[Twitch] Connecting bot client as '${botUsername}'...`);
            const botOauthToken = await ensureValidToken(clientId, clientSecret, 'bot', tokens);
            
            botClient = new tmi.Client({
                options: { debug: false },
                identity: {
                    username: botUsername,
                    password: `oauth:${botOauthToken.replace('oauth:', '')}`
                },
                channels: [broadcasterUsername]
            });
            
            botClient.on('connected', () => {
                console.log(`[Twitch] Bot client connected as ${botUsername}`);
            });
            
            // Bot client should NOT listen to messages to prevent duplicates
            
            await botClient.connect();
        }

        // Setup broadcaster client for listening to chat
        console.log(`[Twitch] Connecting broadcaster client as '${broadcasterUsername}'...`);
        broadcasterClient = new tmi.Client({
            options: { debug: true },
            identity: {
                username: broadcasterUsername,
                password: `oauth:${broadcasterOauthToken.replace('oauth:', '')}`
            },
            channels: [broadcasterUsername]
        });

        broadcasterClient.on('connecting', (address, port) => {
            console.log(`[Twitch] Connecting to ${address}:${port}...`);
        });

        broadcasterClient.on('reconnect', () => {
            console.log('[Twitch] Reconnecting to chat...');
            twitchStatus = 'connecting';
        });

        broadcasterClient.on('notice', (channel, msgid, message) => {
            console.log(`[Twitch] Notice: ${message} (${msgid})`);
        });

        broadcasterClient.on('connected', async (address, port) => {
            console.log(`[Twitch] Broadcaster client connected to ${address}:${port}`);
            twitchStatus = 'connected';
            connectionAttempts = 0; // Reset retry counter on successful connection
            
            setTimeout(async () => {
                try {
                    console.log('[Twitch] Loading badges...');
                    const { getChannelBadges } = require('./twitch');
                    const badges = await getChannelBadges();
                    console.log(`[Twitch] Loaded ${Object.keys(badges || {}).length} badges`);
                    const broadcast = (global as any).broadcast;
                    if (typeof broadcast === 'function') {
                        broadcast({
                            type: 'twitch-badges',
                            payload: { badges }
                        });
                        console.log('[Twitch] Badges broadcast to clients');
                    }
                } catch (e) {
                    console.warn('[Twitch] Failed to fetch badges:', e);
                }
            }, 1000);
            
            const broadcast = (global as any).broadcast;
            if (typeof broadcast === 'function') {
                broadcast({
                    type: 'twitch-status',
                    payload: { status: 'connected' }
                });
            }
        });

        broadcasterClient.on('disconnected', (reason) => {
            console.log(`[Twitch] Disconnected: ${reason}`);
            twitchStatus = 'disconnected';
            connectionAttempts++;
            
            const broadcast = (global as any).broadcast;
            if (typeof broadcast === 'function') {
                broadcast({
                    type: 'twitch-status',
                    payload: { status: 'disconnected' },
                });
            }
            
            // Only retry if under max attempts and not a permanent failure
            if (connectionAttempts < MAX_RETRY_ATTEMPTS && reason !== 'Login authentication failed') {
                scheduleRetry(userId);
            } else {
                console.log(`[Twitch] Max retry attempts reached or permanent failure. Stopping retries.`);
            }
        });

        broadcasterClient.on('message', async (channel, tags, message, self) => {
            // Check for mirrored shared-chat messages
            const { isMirroredSharedMessage, resolveRoomIdToLogin, shouldIgnoreMirrored } = await import('./shared-chat');
            const isMirrored = isMirroredSharedMessage(tags);
            
            // In 'single' mode, skip mirrored messages entirely
            if (shouldIgnoreMirrored(tags)) {
                return;
            }
            
            // For mirrored messages in 'shared' mode, resolve the actual source channel
            let effectiveChannel = channel;
            if (isMirrored) {
                const sourceRoomId = tags['source-room-id'] || tags['source-id'];
                const rawChannel = channel.replace('#', '');
                effectiveChannel = '#' + await resolveRoomIdToLogin(sourceRoomId, rawChannel);
                console.log(`[Twitch] Shared chat message mapped ${channel} -> ${effectiveChannel}`);
            }
            
            if (typeof (global as any).broadcast === 'function') {
                (global as any).broadcast({
                    type: 'twitch-message',
                    payload: {
                        id: tags.id || Date.now().toString(),
                        user: tags.username,
                        message: message,
                        color: tags.color,
                        badges: tags.badges,
                        emotes: tags.emotes,
                        isMirrored,
                        sourceChannel: isMirrored ? effectiveChannel.replace('#', '') : undefined
                    }
                });
            }

            // Pass the effective channel to the dispatcher
            await handleTwitchMessage(effectiveChannel, tags, message, self);
        });

        await broadcasterClient.connect();
        console.log('[Twitch] Connection initiated successfully.');
        isSetupInProgress = false;
        
    } catch (error) {
        console.error('[Twitch] Setup failed:', error);
        twitchStatus = 'disconnected';
        isSetupInProgress = false;
        scheduleRetry(userId);
    }
}

export function getTwitchClient(type: 'bot' | 'broadcaster' = 'bot'): tmi.Client | null {
    const client = type === 'bot' ? botClient : broadcasterClient;
    console.log(`[Twitch] getTwitchClient('${type}') - returning ${type === 'bot' ? 'botClient' : 'broadcasterClient'}, exists: ${!!client}`);
    
    if (type === 'bot' && !botClient) {
        console.log('[Twitch] Bot client requested but not available, falling back to broadcaster client');
        return broadcasterClient;
    }
    
    // Check if client exists and is connected
    if (client && client.readyState() === 'OPEN') {
        return client;
    }
    
    console.log(`[Twitch] Client ${type} not ready, state: ${client?.readyState() || 'null'}`);
    return client; // Return even if not ready, let caller handle reconnection
}

export function getTwitchStatus(): string {
    console.log(`[Twitch] getTwitchStatus called, returning: ${twitchStatus}`);
    return twitchStatus;
}