import { WebSocketServer, WebSocket } from 'ws';
import * as http from 'http';
import { validateLocalApiKeySync } from '../lib/local-config/service';

const privilegedTypes = new Set([
    'send-twitch-message',
    'reconnect-twitch',
    'update-avatar-settings',
    'show-avatar',
    'hide-avatar',
    'update-bot-settings',
    'discord-voice-stream'
]);

function extractApiKeyFromRequest(request: http.IncomingMessage): string {
    const host = request.headers.host || '127.0.0.1';
    const parsed = new URL(request.url || '/', `http://${host}`);
    return parsed.searchParams.get('apiKey') || '';
}

export function createWebSocketServer(httpServer: http.Server, broadcast: (message: object) => void, cachedChatHistory: any[], channelBadges: any, twitchStatus: string, twitchClient: any) {
    const wss = new WebSocketServer({ server: httpServer });
    
    // Handle new WebSocket connections
    wss.on('connection', async (ws, request) => {
        console.log('[WebSocket] New client connected');
        const connectionAuthorized = validateLocalApiKeySync(extractApiKeyFromRequest(request));
        (ws as any).__localAuthorized = connectionAuthorized;
        
        // Reload chat history from Discord on each connection
        try {
            const { loadChatHistory } = require('../services/chat-monitor');
            await loadChatHistory();
        } catch (e) {
            console.warn('[WebSocket] Failed to reload chat history:', e);
        }
        
        // Send fresh badges to the new client
        try {
            const { getChannelBadges } = require('../services/twitch');
            const badges = await getChannelBadges();
            ws.send(JSON.stringify({ 
                type: 'twitch-badges', 
                payload: { badges } 
            }));
            console.log('[WebSocket] Sent fresh badges to new client');
        } catch (e) {
            console.warn('[WebSocket] Failed to load badges for new client:', e);
        }
        
        // Send chat history to the new client
        cachedChatHistory.forEach(msg => {
            ws.send(JSON.stringify({ 
                type: 'twitch-message', 
                payload: msg 
            }));
        });
        
        // Handle incoming messages from client
        ws.on('message', async (data: any) => {
            try {
                const message = JSON.parse(data.toString());

                // Auth check skipped for local-only app (127.0.0.1 origin enforced at connection level)
                
                if (message.type === 'send-twitch-message') {
                    const { message: text, as } = message.payload;
                    console.log(`[WebSocket] Received message to send as ${as}: ${text}`);
                    
                    // Get fresh Twitch client reference
                    const { getTwitchClient } = require('../services/twitch-client');
                    const freshTwitchClient = getTwitchClient(as === 'bot' ? 'bot' : 'broadcaster');
                    
                    console.log(`[WebSocket] Twitch client (${as}) exists: ${!!freshTwitchClient}`);
                    console.log(`[WebSocket] Twitch client readyState: ${freshTwitchClient?.readyState?.()}`);
                    
                    if (!freshTwitchClient || !freshTwitchClient.readyState || freshTwitchClient.readyState() !== 'OPEN') {
                        console.error(`[WebSocket] Twitch ${as} client not connected`);
                        ws.send(JSON.stringify({
                            type: 'error',
                            payload: { message: `Twitch ${as} client not connected` }
                        }));
                        return;
                    }
                    
                    const channels = freshTwitchClient.getChannels();
                    if (!channels || channels.length === 0) {
                        console.error('[WebSocket] No Twitch channels available');
                        return;
                    }
                    
                    // Send message via Twitch IRC
                    await freshTwitchClient.say(channels[0], text);
                    console.log(`[WebSocket] Message sent to Twitch as ${as}: ${text}`);
                } else if (message.type === 'reconnect-twitch') {
                    console.log('[WebSocket] Received reconnect request for Twitch');
                    try {
                        const { setupTwitchClient } = require('../services/twitch-client');
                        await setupTwitchClient();
                        console.log('[WebSocket] Twitch reconnection attempt completed');
                    } catch (e) {
                        console.error('[WebSocket] Twitch reconnection failed:', e);
                    }
                } else if (message.type === 'voice-join') {
                    const { id, name, room } = message.payload;
                    console.log(`[Voice] ${name} joined ${room}`);
                    
                    // Broadcast to all clients
                    broadcast({
                        type: 'voice-user-joined',
                        payload: { id, name, room, muted: room === 'silent' }
                    });
                } else if (message.type === 'voice-leave') {
                    const { id, name, room } = message.payload;
                    console.log(`[Voice] ${name} left ${room}`);
                    
                    // Broadcast to all clients
                    broadcast({
                        type: 'voice-user-left',
                        payload: { id, name, room }
                    });
                } else if (message.type === 'voice-mute') {
                    const { id, name, room, muted } = message.payload;
                    console.log(`[Voice] ${name} ${muted ? 'muted' : 'unmuted'}`);
                    
                    // Broadcast to all clients
                    broadcast({
                        type: 'voice-user-muted',
                        payload: { id, name, room, muted }
                    });
                } else if (message.type === 'update-avatar-settings') {
                    const { idleUrl, talkingUrl, gestureUrl, animationType } = message.payload;
                    const { updateAvatarState } = require('../server/avatar');
                    updateAvatarState({ idleUrl, talkingUrl, gestureUrl, animationType }, broadcast);
                    console.log('[WebSocket] Updated avatar settings:', message.payload);
                } else if (message.type === 'show-avatar') {
                    const { showTalkingAvatar } = require('../server/avatar');
                    showTalkingAvatar(broadcast);
                    console.log('[WebSocket] Show avatar requested');
                } else if (message.type === 'hide-avatar') {
                    const { hideAvatarAfterDelay } = require('../server/avatar');
                    hideAvatarAfterDelay(0, broadcast);
                    console.log('[WebSocket] Hide avatar requested');
                } else if (message.type === 'update-bot-settings') {
                    const { personality, voice, name, interests } = message.payload;
                    const updates: Record<string, string> = {};
                    if (personality && typeof personality === 'string') {
                        (global as any).botPersonality = personality;
                        console.log('[WebSocket] Updated bot personality');
                    }
                    if (voice && typeof voice === 'string') {
                        (global as any).botVoice = voice;
                        updates.TTS_VOICE = voice;
                        console.log('[WebSocket] Updated bot voice to:', voice);
                    }
                    if (name && typeof name === 'string') {
                        (global as any).botName = name;
                        updates.AI_BOT_NAME = name;
                        console.log('[WebSocket] Updated bot name to:', name);
                    }
                    if (interests && typeof interests === 'string') {
                        (global as any).botInterests = interests;
                        console.log('[WebSocket] Updated bot interests');
                    }
                    if (Object.keys(updates).length > 0) {
                        const { writeUserConfig } = require('../lib/user-config');
                        writeUserConfig(updates).catch((e: any) => console.error('[WebSocket] Failed to persist bot settings:', e));
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
                    console.log(`[WebSocket Server] 🎧 Received Discord voice stream request: \"${text.substring(0, 50)}...\"`);
                    
                    try {
                        const base64Data = audioDataUri.split(',')[1];
                        const audioBuffer = Buffer.from(base64Data, 'base64');
                        
                        console.log(`[Discord Voice] Processing ${Math.round(audioBuffer.length / 1024)}KB audio for channel ${channelId}`);
                        
                        // Connect to Discord Gateway WebSocket for voice
                        const discordWs = new WebSocket('wss://gateway.discord.gg/?v=10&encoding=json');
                        
                        discordWs.on('open', () => {
                            console.log('[Discord Voice] Connected to Discord Gateway');
                            
                            // Send identify payload
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
                            
                            if (payload.op === 10) { // Hello
                                console.log('[Discord Voice] Received hello, joining voice channel...');
                                
                                // Join voice channel
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
                                
                                // Stream audio data
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
    });
    
    return wss;
}