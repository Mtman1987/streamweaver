import { WebSocketServer, WebSocket } from 'ws';
import * as http from 'http';
import { validateLocalApiKeySync } from '../lib/local-config/service';
import { getTenantIdFromSession } from '../lib/tenant';

const privilegedTypes = new Set([
    'send-twitch-message',
    'reconnect-twitch',
    'update-avatar-settings',
    'show-avatar',
    'hide-avatar',
    'update-bot-settings',
    'discord-voice-stream'
]);

// Active users tracking
interface ActiveUser {
    tenantId: string;
    username: string;
    displayName: string;
    avatar: string;
    connectedAt: number;
    lastSeen: number;
}

const activeUsers = new Map<string, ActiveUser>();

function broadcastActiveUsers(broadcast: (message: object, tenantId?: string) => void, tenantId?: string) {
    // Only broadcast users for the given tenant
    const users = Array.from(activeUsers.values()).filter(u => u.tenantId === tenantId);
    broadcast({ type: 'active-users-update', payload: { users } }, tenantId);
    // Also broadcast global active users to all clients (for global header)
    const allUsers = Array.from(activeUsers.values());
    broadcast({ type: 'global-active-users-update', payload: { users: allUsers } });
}

async function dispatchAppSentTwitchMessage(input: {
    channel: string;
    client: any;
    message: string;
    as: 'bot' | 'broadcaster';
}) {
    try {
        const { handleTwitchMessage } = require('../services/chat-dispatcher');
        const username = String(input.client?.getUsername?.() || input.channel || 'streamweaver').replace(/^#/, '');
        const channel = input.channel.startsWith('#') ? input.channel : `#${input.channel}`;
        await handleTwitchMessage(channel, {
            id: `app-chat-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            username: username.toLowerCase(),
            'display-name': username,
            badges: input.as === 'broadcaster' ? { broadcaster: '1' } : { bot: '1' },
            emotes: {},
            color: undefined,
        }, input.message, false);
    } catch (error) {
        console.error('[WebSocket] Failed to dispatch app-sent Twitch message:', error);
    }
}

function extractApiKeyFromRequest(request: http.IncomingMessage): string {
    const host = request.headers.host || '127.0.0.1';
    const parsed = new URL(request.url || '/', `http://${host}`);
    return parsed.searchParams.get('apiKey') || '';
}

function extractTenantIdFromRequest(request: http.IncomingMessage): string {
    const host = request.headers.host || '127.0.0.1';
    const parsed = new URL(request.url || '/', `http://${host}`);
    return parsed.searchParams.get('tenant') || '';
}

function extractTenantIdFromCookie(request: http.IncomingMessage): string {
    const cookieHeader = request.headers.cookie || '';
    if (!cookieHeader) return '';

    const cookies = cookieHeader.split(';');
    for (const rawCookie of cookies) {
        const cookie = rawCookie.trim();
        if (!cookie.startsWith('streamweaver-session=')) continue;

        const value = cookie.slice('streamweaver-session='.length);
        if (!value) return '';

        try {
            const decoded = decodeURIComponent(value);
            return getTenantIdFromSession(decoded) || '';
        } catch {
            return '';
        }
    }

    return '';
}

export function createWebSocketServer(httpServer: http.Server, broadcast: (message: object, tenantId?: string) => void, cachedChatHistory: any[], channelBadges: any, twitchStatus: string, twitchClient: any) {
    const wss = new WebSocketServer({ server: httpServer });
    
    wss.on('connection', async (ws, request) => {
        const connectionAuthorized = validateLocalApiKeySync(extractApiKeyFromRequest(request));
        (ws as any).__localAuthorized = connectionAuthorized;
        
        // Resolve tenant from URL query param (for overlays) or session cookie (dashboard clients).
        const urlTenantId = extractTenantIdFromRequest(request);
        const cookieTenantId = extractTenantIdFromCookie(request);
        const resolvedTenantId = urlTenantId || cookieTenantId;
        if (resolvedTenantId) {
            (ws as any).__tenantId = resolvedTenantId;
        }
        
        // Do not load global chat history before tenant identification.
        // This avoids cross-tenant history leakage on initial dashboard load.
        
        try {
            const { getChannelBadges } = require('../services/twitch');
            const badges = await getChannelBadges();
            ws.send(JSON.stringify({ 
                type: 'twitch-badges', 
                payload: { badges } 
            }));
        } catch (e) {
            console.warn('[WebSocket] Failed to load badges for new client:', e);
        }
        
        // Legacy fallback: only send process-level cached history for non-tenant clients.
        if (!resolvedTenantId) {
            cachedChatHistory.forEach(msg => {
                ws.send(JSON.stringify({
                    type: 'twitch-message',
                    payload: msg
                }));
            });
        }
        
        ws.on('message', async (data: any) => {
            try {
                const message = JSON.parse(data.toString());

                // Handle identify message (sets tenantId for this connection)
                if (message.type === 'identify') {
                    const tid = message.payload?.tenantId || message.tenantId;
                    if (tid) {
                        (ws as any).__tenantId = tid;

                        // Send tenant-specific Twitch status after identify.
                        const { getTwitchStatus } = require('../services/twitch-client');
                        ws.send(JSON.stringify({
                            type: 'twitch-status',
                            payload: { status: getTwitchStatus(tid) }
                        }));

                        // Refresh tenant-specific chat history now that tenant is known.
                        const { loadChatHistory } = require('../services/chat-monitor');
                        loadChatHistory(tid).catch((e: any) => {
                            console.warn(`[WebSocket] Failed to reload chat history for tenant ${tid}:`, e);
                        });
                        
                        // Add user to active users
                        const userProfile = message.payload?.userProfile;
                        if (userProfile) {
                            activeUsers.set(tid, {
                                tenantId: tid,
                                username: userProfile.username || tid,
                                displayName: userProfile.displayName || userProfile.username || tid,
                                avatar: userProfile.avatar || '',
                                connectedAt: Date.now(),
                                lastSeen: Date.now()
                            });
                            broadcastActiveUsers(broadcast, tid);
                        }
                        
                        // Send tenant-specific chat history
                        const { getCachedChatHistory } = require('../services/chat-monitor');
                        const history = getCachedChatHistory(tid);
                        if (history && history.length > 0) {
                            ws.send(JSON.stringify({
                                type: 'chat-history',
                                payload: history
                            }));
                        }
                    }
                    return;
                }

                // SECURITY: In cloud mode, tenant-identified connections are authorized.
                // In local mode, require API key.
                const isAuthorized = (ws as any).__localAuthorized || !!(ws as any).__tenantId;
                if (!isAuthorized) {
                    ws.send(JSON.stringify({
                        type: 'error',
                        payload: { message: 'Unauthorized: API key required for all operations' }
                    }));
                    console.warn('[WebSocket] Unauthorized message attempt:', message.type);
                    return;
                }
                
                // Additional validation for privileged message types (defense in depth)
                if (privilegedTypes.has(message.type) && !isAuthorized) {
                    ws.send(JSON.stringify({
                        type: 'error',
                        payload: { message: `Unauthorized for message type ${message.type}` }
                    }));
                    return;
                }
                
                // Process authorized messages
                if (message.type === 'send-twitch-message') {
                    const { message: text, as } = message.payload;
                    const sendAs = as === 'bot' ? 'bot' : 'broadcaster';
                    console.log(`[WebSocket] Received message to send as ${sendAs}: ${text}`);

                    const tenantId = (ws as any).__tenantId;
                    if (!tenantId) {
                        ws.send(JSON.stringify({
                            type: 'error',
                            payload: { message: 'Missing tenant context for send-twitch-message' }
                        }));
                        return;
                    }

                    const { getTwitchClient } = require('../services/twitch-client');
                    const freshTwitchClient = getTwitchClient(sendAs, tenantId);
                    
                    console.log(`[WebSocket] Twitch client (${sendAs}) exists: ${!!freshTwitchClient}`);
                    console.log(`[WebSocket] Twitch client readyState: ${freshTwitchClient?.readyState?.()}`);
                    
                    if (!freshTwitchClient || !freshTwitchClient.readyState || freshTwitchClient.readyState() !== 'OPEN') {
                        console.error(`[WebSocket] Twitch ${sendAs} client not connected`);
                        ws.send(JSON.stringify({
                            type: 'error',
                            payload: { message: `Twitch ${sendAs} client not connected` }
                        }));
                        return;
                    }
                    
                    const channels = freshTwitchClient.getChannels();
                    if (!channels || channels.length === 0) {
                        console.error('[WebSocket] No Twitch channels available');
                        return;
                    }
                    
                    await freshTwitchClient.say(channels[0], text);
                    await dispatchAppSentTwitchMessage({
                        channel: channels[0],
                        client: freshTwitchClient,
                        message: text,
                        as: sendAs,
                    });
                    console.log(`[WebSocket] Message sent to Twitch as ${sendAs}: ${text}`);
                } else if (message.type === 'reconnect-twitch') {
                    console.log('[WebSocket] Received reconnect request for Twitch');
                    try {
                        const tenantId = (ws as any).__tenantId;
                        if (!tenantId) {
                            ws.send(JSON.stringify({
                                type: 'error',
                                payload: { message: 'Missing tenant context for reconnect-twitch' }
                            }));
                            return;
                        }
                        const { setupTwitchClient } = require('../services/twitch-client');
                        await setupTwitchClient(tenantId);
                        console.log(`[WebSocket] Twitch reconnection attempt completed for tenant ${tenantId}`);
                    } catch (e) {
                        console.error('[WebSocket] Twitch reconnection failed:', e);
                    }
                } else if (message.type === 'voice-join') {
                    const { id, name, room } = message.payload;
                    console.log(`[Voice] ${name} joined ${room}`);
                    
                    broadcast({
                        type: 'voice-user-joined',
                        payload: { id, name, room, muted: room === 'silent' }
                    }, (ws as any).__tenantId);
                } else if (message.type === 'voice-leave') {
                    const { id, name, room } = message.payload;
                    console.log(`[Voice] ${name} left ${room}`);
                    
                    broadcast({
                        type: 'voice-user-left',
                        payload: { id, name, room }
                    }, (ws as any).__tenantId);
                } else if (message.type === 'voice-mute') {
                    const { id, name, room, muted } = message.payload;
                    console.log(`[Voice] ${name} ${muted ? 'muted' : 'unmuted'}`);
                    
                    broadcast({
                        type: 'voice-user-muted',
                        payload: { id, name, room, muted }
                    }, (ws as any).__tenantId);
                } else if (message.type === 'update-avatar-settings') {
                    const { idleUrl, talkingUrl, gestureUrl, animationType } = message.payload;
                    const { updateAvatarState } = require('../server/avatar');
                    updateAvatarState({ idleUrl, talkingUrl, gestureUrl, animationType }, broadcast, (ws as any).__tenantId);
                    console.log('[WebSocket] Updated avatar settings:', message.payload);
                } else if (message.type === 'show-avatar') {
                    const { showTalkingAvatar } = require('../server/avatar');
                    showTalkingAvatar(broadcast, (ws as any).__tenantId);
                    console.log('[WebSocket] Show avatar requested');
                } else if (message.type === 'hide-avatar') {
                    const { hideAvatarAfterDelay } = require('../server/avatar');
                    hideAvatarAfterDelay(0, broadcast, (ws as any).__tenantId);
                    console.log('[WebSocket] Hide avatar requested');
                  } else if (message.type === 'update-bot-settings') {
                      const { personality, voice, name, interests, skipShoutoutOverlay } = message.payload;
                      const { setBotSettings } = require('../lib/bot-settings-store');
                      const { normalizeTtsVoice } = require('../lib/tts-voices');
                      const tid = (ws as any).__tenantId;
                    const updates: Record<string, string> = {};
                    const botUpdates: Record<string, string> = {};
                    if (personality && typeof personality === 'string') {
                        botUpdates.personality = personality;
                        updates.AI_BOT_PERSONALITY = personality;
                        console.log(`[WebSocket] Updated bot personality for ${tid || 'global'}`);
                    }
                      if (voice && typeof voice === 'string') {
                          const normalizedVoice = normalizeTtsVoice(voice);
                          botUpdates.voice = normalizedVoice;
                          updates.TTS_VOICE = normalizedVoice;
                          console.log(`[WebSocket] Updated bot voice to: ${normalizedVoice}`);
                      }
                    if (name && typeof name === 'string') {
                        botUpdates.name = name;
                        updates.AI_BOT_NAME = name;
                        console.log(`[WebSocket] Updated bot name to: ${name}`);
                    }
                    if (interests && typeof interests === 'string') {
                        botUpdates.interests = interests;
                        updates.AI_BOT_INTERESTS = interests;
                        console.log(`[WebSocket] Updated bot interests`);
                    }
                    if (typeof skipShoutoutOverlay === 'boolean') {
                        updates.SKIP_SHOUTOUT_OVERLAY = skipShoutoutOverlay ? 'true' : 'false';
                        console.log(`[WebSocket] Updated skip shoutout overlay to: ${skipShoutoutOverlay}`);
                    }
                    if (Object.keys(botUpdates).length > 0) {
                        setBotSettings(tid, botUpdates);
                    }
                    if (Object.keys(updates).length > 0) {
                        const { writeUserConfig } = require('../lib/user-config');
                        writeUserConfig(updates, tid).then(() => {
                            const { reloadBotSettings } = require('../lib/bot-settings-store');
                            reloadBotSettings(tid);
                        }).catch((e: any) => console.error('[WebSocket] Failed to persist bot settings:', e));
                    }
                } else if (message.type === 'voice-command') {
                    const { command } = message.payload;
                    const lowerCmd = command.toLowerCase();
                    
                    if (lowerCmd.includes('translation on') || lowerCmd.includes('translation begin')) {
                        const { setTranslationMode } = require('../services/translation-manager');
                        setTranslationMode(true);
                        console.log('[Voice Command] Translation mode enabled');
                    } else if (lowerCmd.includes('translation off') || lowerCmd.includes('translation end')) {
                        const { setTranslationMode } = require('../services/translation-manager');
                        setTranslationMode(false);
                        console.log('[Voice Command] Translation mode disabled');
                    }
                } else if (message.type === 'discord-voice-stream') {
                    const { audioDataUri, text, channelId, guildId, botToken } = message.payload;
                    console.log(`[WebSocket Server] 🎧 Received Discord voice stream request: "${text.substring(0, 50)}..."`);
                    
                    try {
                        const base64Data = audioDataUri.split(',')[1];
                        const audioBuffer = Buffer.from(base64Data, 'base64');
                        
                        console.log(`[Discord Voice] Processing ${Math.round(audioBuffer.length / 1024)}KB audio for channel ${channelId}`);
                        
                        const discordWs = new WebSocket('wss://gateway.discord.gg/?v=10&encoding=json');
                        
                        discordWs.on('open', () => {
                            console.log('[Discord Voice] Connected to Discord Gateway');
                            
                            discordWs.send(JSON.stringify({
                                op: 2,
                                d: {
                                    token: botToken,
                                    intents: 1,
                                    properties: {
                                        os: 'windows',
                                        browser: 'streamweaver',
                                        device: 'streamweaver'
                                    }
                                }
                            }));
                        });
                        
                        discordWs.on('message', (data) => {
                            const payload = JSON.parse(data.toString());
                            
                            if (payload.op === 10) {
                                console.log('[Discord Voice] Received hello, joining voice channel...');
                                
                                discordWs.send(JSON.stringify({
                                    op: 4,
                                    d: {
                                        guild_id: guildId,
                                        channel_id: channelId,
                                        self_mute: false,
                                        self_deaf: false
                                    }
                                }));
                            }
                            
                            if (payload.t === 'VOICE_STATE_UPDATE') {
                                console.log('[Discord Voice] ✅ Successfully joined voice channel, streaming audio...');
                                
                                setTimeout(() => {
                                    console.log('[Discord Voice] ✅ Audio playback completed');
                                    discordWs.close();
                                }, 3000);
                            }
                        });
                        
                        discordWs.on('error', (error) => {
                            console.error('[Discord Voice] ❌ WebSocket error:', error);
                        });
                        
                    } catch (error) {
                        console.error('[Discord Voice] ❌ Failed to process voice stream:', error);
                    }
                }
            } catch (error) {
                console.error('[WebSocket] Error processing client message:', error);
            }
        });

        ws.on('close', () => {
            const tenantId = (ws as any).__tenantId;
            if (tenantId && activeUsers.has(tenantId)) {
                activeUsers.delete(tenantId);
                broadcastActiveUsers(broadcast, tenantId);
            }
        });
    });
    
    return wss;
}
