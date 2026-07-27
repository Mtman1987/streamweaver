import * as http from 'http';
import * as url from 'url';
import { resolve } from 'path';
import { promises as fs } from 'fs';
import { validateLocalApiKeySync } from '../lib/local-config/service';
import { readDiscordConfig } from '../lib/discord-config';
import { getConfiguredAppUrl, isAllowedOrigin } from '../lib/runtime-origin';
import { getAdminTwitchId, tenantPath } from '../lib/tenant';
import { readUserConfigSync } from '../lib/user-config';
import { isKnownInternalSecret } from '../lib/internal-service-auth';

function isAuthorized(headers: http.IncomingHttpHeaders): boolean {
    const key = headers['x-api-key'];
    const apiKey = Array.isArray(key) ? key[0] : key;
    return validateLocalApiKeySync(apiKey || '');
}

function getStatusWebSocketUrl(): string {
    const explicitUrl = process.env.NEXT_PUBLIC_STREAMWEAVE_WS_URL;
    if (explicitUrl) {
        return explicitUrl;
    }

    const appUrl = new URL(getConfiguredAppUrl());
    const wsProtocol = appUrl.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsPort = process.env.NEXT_PUBLIC_STREAMWEAVE_WS_PORT || process.env.WS_PORT || '8090';
    return `${wsProtocol}//${appUrl.hostname}:${wsPort}`;
}

async function getDiscordBridgeTarget(tenantId?: string): Promise<string | null> {
    if (!tenantId) return null;

    try {
        const channels = await readDiscordConfig(tenantId);
        if (channels?.discordBridgeEnabled === false) return null;
        return typeof channels?.logChannelId === 'string' ? channels.logChannelId.trim() || null : null;
    } catch {}
    return null;
}

function isInternalServiceAuthorized(headers: http.IncomingHttpHeaders): boolean {
    const authorization = String(headers.authorization || '');
    const bearer = authorization.startsWith('Bearer ') ? authorization.slice('Bearer '.length).trim() : '';
    const botSecretHeader = headers['x-bot-secret'];
    const botSecret = Array.isArray(botSecretHeader) ? botSecretHeader[0] : String(botSecretHeader || '');
    return isKnownInternalSecret(bearer || botSecret);
}

async function mirrorOutboundTwitchMessageToDiscord(input: {
    bridgeToDiscord: unknown;
    tenantId?: string;
    message: unknown;
    displayName: string;
}): Promise<void> {
    const { bridgeToDiscord, tenantId, message, displayName } = input;
    if (bridgeToDiscord !== true) return;
    if (!tenantId || typeof message !== 'string' || !message.trim()) return;
    if (message.startsWith('[Discord]')) return;

    const logChannelId = await getDiscordBridgeTarget(tenantId);
    if (!logChannelId) {
        if (process.env.STREAMWEAVER_VERBOSE_LOGS === 'true') {
            console.log(`[HTTP /api/twitch/send-message] No Discord bridge channel for tenant ${tenantId}`);
        }
        return;
    }

    try {
        const { sendDiscordMessage } = require('../services/discord');
        await sendDiscordMessage(logChannelId, `**[Twitch] ${displayName}:** ${message}`);
    } catch (error) {
        console.error('[HTTP /api/twitch/send-message] Failed to mirror outbound Twitch message to Discord:', error);
    }
}

export function createHttpHandler(broadcast: (message: object, tenantId?: string) => number | void): http.RequestListener {
    // Import twitch-client at handler creation time (same module instance as server.ts)
    const twitchClientModule = require('../services/twitch-client');

    return async (req, res) => {
        const parsedUrl = url.parse(req.url || '', true);
        const pathname = parsedUrl.pathname;
        console.log(`[HTTP] ${req.method} ${pathname}`);

        const origin = req.headers.origin;
        if (!isAllowedOrigin(origin)) {
            res.writeHead(403, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Forbidden origin' }));
            return;
        }
        
        if (isAllowedOrigin(origin)) {
            res.setHeader('Access-Control-Allow-Origin', origin || getConfiguredAppUrl());
        }
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-API-Key');
        
        if (req.method === 'OPTIONS') {
            res.writeHead(200);
            res.end();
            return;
        }
        
        try {
            if (pathname === '/api/overlay/broadcast' && req.method === 'POST') {
                if (!isInternalServiceAuthorized(req.headers)) {
                    res.writeHead(401, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Unauthorized' }));
                    return;
                }

                let body = '';
                req.on('data', chunk => body += chunk);
                req.on('end', () => {
                    try {
                        const parsed = JSON.parse(body);
                        const tenantId = String(parsed?.tenantId || '').trim();
                        const messages = Array.isArray(parsed?.messages) ? parsed.messages : [];
                        const allowedTypes = new Set(['pokemon-pack-opened', 'quackverse-pack-opened', 'public-image-generated']);
                        if (!tenantId || messages.length === 0 || messages.some((message: any) => !message || !allowedTypes.has(String(message.type || '')))) {
                            res.writeHead(400, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ error: 'Invalid overlay broadcast request' }));
                            return;
                        }

                        const delivered = messages.reduce(
                            (total: number, message: object) => total + Number(broadcast(message, tenantId) || 0),
                            0,
                        );
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: true, tenantId, delivered }));
                    } catch (error) {
                        console.error('[HTTP /api/overlay/broadcast] Error:', error);
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: 'Invalid request body' }));
                    }
                });
                return;
            }

            if (pathname === '/api/auth/share' && req.method === 'GET') {
                if (!isAuthorized(req.headers)) {
                    res.writeHead(401, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Unauthorized' }));
                    return;
                }

                // In multi-tenant mode this endpoint is less useful; return basic status
                const authData = {
                    twitch: {
                        connected: false
                    },
                    discord: {
                        connected: Boolean(process.env.DISCORD_BOT_TOKEN)
                    }
                };
                
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(authData));
                return;
            }
            
            if (pathname === '/api/discord/members' && req.method === 'GET') {
                if (!isAuthorized(req.headers)) {
                    res.writeHead(401, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Unauthorized' }));
                    return;
                }

                const botToken = process.env.DISCORD_BOT_TOKEN;
                if (!botToken) {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Discord bot token not configured' }));
                    return;
                }
                
                const guildId = parsedUrl.query.guildId || '1340315377774755890';
                const response = await fetch(`https://discord.com/api/v10/guilds/${guildId}/members?limit=1000`, {
                    headers: {
                        'Authorization': `Bot ${botToken}`,
                        'Content-Type': 'application/json'
                    }
                });
                
                if (!response.ok) {
                    res.writeHead(response.status, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Failed to fetch Discord members' }));
                    return;
                }
                
                const members = await response.json();
                const memberList = members.map((member: any) => ({
                    id: member.user?.id,
                    username: member.user?.username,
                    displayName: member.nick || member.user?.display_name || member.user?.username,
                    avatar: member.user?.avatar,
                    joinedAt: member.joined_at,
                    roles: member.roles || []
                }));
                
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ members: memberList }));
                return;
            }
            
            if (pathname === '/api/twitch/send-message' && req.method === 'POST') {
                let body = '';
                req.on('data', chunk => body += chunk);
                req.on('end', async () => {
                    try {
                        const { message, as, targetChannel, tenantId: requestedTenantId, bridgeToDiscord } = JSON.parse(body);
                        
                        if (message.startsWith('[Discord]') && requestedTenantId) {
                            try {
                                const channels = await readDiscordConfig(requestedTenantId);
                                if (channels.discordBridgeEnabled === false) {
                                    console.log('[HTTP /api/twitch/send-message] Discord bridge disabled, skipping message');
                                    res.writeHead(200, { 'Content-Type': 'application/json' });
                                    res.end(JSON.stringify({ success: true, skipped: true }));
                                    return;
                                }
                            } catch {}
                        }
                        
                        console.log(`[HTTP /api/twitch/send-message] Sending as '${as || 'bot'}': ${message}`);
                        
                        const { getActiveTenantIds, getTwitchClient: getTc } = twitchClientModule;
                        const { sendWithSharedChatAwareness } = require('../services/shared-chat');
                        const clientType = as === 'broadcaster' ? 'broadcaster' : 'bot';
                        let sendAs: 'bot' | 'broadcaster' = clientType;
                        console.log(`[HTTP /api/twitch/send-message] Requesting client type: ${clientType}`);
                        
                        // Resolve tenant in strict order:
                        // 1) explicit tenantId from caller
                        // 2) targetChannel mapping
                        // 3) single-tenant fallback only when exactly one tenant is active
                        let channel = targetChannel || '';
                        let client = null;
                        let tid: string | undefined = undefined;

                        if (requestedTenantId) {
                            tid = String(requestedTenantId);
                            client = getTc(clientType, tid);
                            if (client) {
                                console.log(`[HTTP /api/twitch/send-message] Found client for tenant ${tid} via explicit tenantId`);
                            }
                        }

                        if (!client && channel) {
                            // Look up tenant by channel name
                            const { getTenantIdFromChannel } = twitchClientModule;
                            tid = getTenantIdFromChannel(channel);
                            if (tid) {
                                client = getTc(clientType, tid);
                                console.log(`[HTTP /api/twitch/send-message] Found client for tenant ${tid} via channel ${channel}`);
                            }
                        }

                        if ((!channel || !channel.trim()) && requestedTenantId) {
                            try {
                                const { getStoredTokens } = require('../lib/token-utils.server');
                                const tokens = await getStoredTokens(String(requestedTenantId));
                                const tenantChannel = String(tokens?.broadcasterUsername || '').trim().toLowerCase();
                                if (tenantChannel) {
                                    channel = tenantChannel;
                                    console.log(`[HTTP /api/twitch/send-message] Resolved channel '${channel}' from tenant ${requestedTenantId} tokens`);
                                }
                            } catch (resolveChannelError) {
                                console.warn('[HTTP /api/twitch/send-message] Failed to resolve tenant broadcaster channel:', resolveChannelError);
                            }
                        }

                        // Owner fallback: ambiguous traffic should resolve to the admin tenant, never
                        // to the first connected tenant.
                        if (!client) {
                            const ownerTenantId = getAdminTwitchId();
                            if (ownerTenantId) {
                                tid = ownerTenantId;
                                client = getTc(clientType, tid);
                                if ((!channel || !channel.trim()) && tid) {
                                    try {
                                        const { getStoredTokens } = require('../lib/token-utils.server');
                                        const tokens = await getStoredTokens(String(tid));
                                        const ownerChannel = String(tokens?.broadcasterUsername || '').trim().toLowerCase();
                                        if (ownerChannel) {
                                            channel = ownerChannel;
                                        }
                                    } catch (resolveOwnerChannelError) {
                                        console.warn('[HTTP /api/twitch/send-message] Failed to resolve owner broadcaster channel:', resolveOwnerChannelError);
                                    }
                                }
                                console.warn(`[HTTP /api/twitch/send-message] Using owner fallback tenant: ${tid}`);
                            }
                        }

                        // Safety fallback for strict single-tenant mode only.
                        if (!client) {
                            const tenantIds = getActiveTenantIds();
                            if (tenantIds.length === 1) {
                                tid = tenantIds[0];
                                client = getTc(clientType, tid);
                                console.log(`[HTTP /api/twitch/send-message] Using single-tenant fallback: ${tid}`);
                            }
                        }

                        if (!client && tid) {
                            console.warn(`[HTTP /api/twitch/send-message] No usable ${clientType} client for tenant ${tid}; attempting reconnect once.`);
                            try {
                                await twitchClientModule.setupTwitchClient(tid);
                                client = getTc(clientType, tid);
                            } catch (reconnectError) {
                                console.error(`[HTTP /api/twitch/send-message] Reconnect attempt failed for tenant ${tid}:`, reconnectError);
                            }
                        }

                        if (!client && clientType === 'broadcaster' && tid) {
                            client = getTc('bot', tid);
                            if (client) {
                                sendAs = 'bot';
                                console.warn(`[HTTP /api/twitch/send-message] Broadcaster client unavailable for tenant ${tid}; sending with bot client instead.`);
                            }
                        }

                        if (!client) {
                            console.error(`[HTTP /api/twitch/send-message] ${clientType} client is null/undefined`);
                            res.writeHead(500, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ error: `${clientType} client not available` }));
                            return;
                        }
                        
                        console.log(`[HTTP /api/twitch/send-message] Client username: ${(client as any).getUsername()}`);
                        
                        const sendChannel = channel || '';
                        
                        // If no target channel specified, use the client's connected channel
                        const finalChannel = sendChannel || (client.getChannels?.()[0]?.replace('#', '') || '');
                        console.log(`[HTTP /api/twitch/send-message] Final channel: ${finalChannel || '(empty)'}`);

                        if (!finalChannel) {
                            throw new Error('No Twitch channel could be resolved for outbound message');
                        }
                        
                        await sendWithSharedChatAwareness({
                            client,
                            channel: finalChannel,
                            message,
                            as: sendAs,
                            tenantId: tid,
                        });
                        await mirrorOutboundTwitchMessageToDiscord({
                            bridgeToDiscord,
                            tenantId: tid,
                            message,
                            displayName: String((client as any).getUsername?.() || sendAs),
                        });
                        
                        console.log(`[HTTP /api/twitch/send-message] Message sent successfully as ${sendAs}`);
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: true }));
                    } catch (e: any) {
                        console.error('[HTTP /api/twitch/send-message] Error:', e);
                        res.writeHead(500, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: e.message }));
                    }
                });
                return;
            }
            
            if (pathname === '/api/__health' && req.method === 'GET') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 'ok' }));
                return;
            }

            if (pathname === '/api/kick/connect' && req.method === 'POST') {
                let body = '';
                req.on('data', chunk => body += chunk);
                req.on('end', async () => {
                    try {
                        const { channelName, tenantId } = JSON.parse(body);
                        if (!channelName) {
                            res.writeHead(400, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ error: 'channelName required' }));
                            return;
                        }
                        const { getMultiPlatformManager } = require('../services/multi-platform');
                        const mp = getMultiPlatformManager();
                        await mp.connectKick(channelName, tenantId);
                        console.log(`[HTTP] ✅ Kick connected for ${channelName} (tenant: ${tenantId})`);
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: true }));
                    } catch (e: any) {
                        console.error('[HTTP] Kick connect failed:', e);
                        res.writeHead(500, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: e.message }));
                    }
                });
                return;
            }

            if (pathname === '/api/kick/disconnect' && req.method === 'POST') {
                let body = '';
                req.on('data', chunk => body += chunk);
                req.on('end', async () => {
                    try {
                        const { tenantId } = JSON.parse(body || '{}');
                        const { getKickService } = require('../services/kick');
                        getKickService(tenantId).disconnect();
                        console.log(`[HTTP] ✅ Kick disconnected (tenant: ${tenantId || 'global'})`);
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: true }));
                    } catch (e: any) {
                        console.error('[HTTP] Kick disconnect failed:', e);
                        res.writeHead(500, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: e.message }));
                    }
                });
                return;
            }

            if (pathname === '/api/twitch/reconnect' && req.method === 'POST') {
                let body = '';
                req.on('data', chunk => body += chunk);
                req.on('end', async () => {
                    try {
                        const { tenantId } = JSON.parse(body);
                        if (!tenantId) {
                            res.writeHead(400, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ error: 'tenantId required' }));
                            return;
                        }
                        console.log(`[HTTP] Reconnecting Twitch IRC for tenant ${tenantId}...`);
                        const { setupTwitchClient } = twitchClientModule;
                        await setupTwitchClient(tenantId);
                        console.log(`[HTTP] Twitch IRC reconnected for tenant ${tenantId}`);
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: true }));
                    } catch (e: any) {
                        console.error('[HTTP] Twitch reconnect failed:', e);
                        res.writeHead(500, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: e.message }));
                    }
                });
                return;
            }

            if (pathname === '/api/twitch/disconnect' && req.method === 'POST') {
                let body = '';
                req.on('data', chunk => body += chunk);
                req.on('end', async () => {
                    try {
                        const { tenantId } = JSON.parse(body || '{}');
                        if (!tenantId) {
                            res.writeHead(400, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ error: 'tenantId required' }));
                            return;
                        }
                        console.log(`[HTTP] Disconnecting Twitch IRC for tenant ${tenantId}...`);
                        const { disconnectTenant } = twitchClientModule;
                        await disconnectTenant(tenantId);
                        console.log(`[HTTP] Twitch IRC disconnected for tenant ${tenantId}`);
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: true }));
                    } catch (e: any) {
                        console.error('[HTTP] Twitch disconnect failed:', e);
                        res.writeHead(500, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: e.message }));
                    }
                });
                return;
            }

            if (pathname === '/api/twitch/community-bot/disconnect' && req.method === 'POST') {
                try {
                    console.log('[HTTP] Disconnecting shared community bot...');
                    const { disconnectCommunityBot } = twitchClientModule;
                    await disconnectCommunityBot();
                    console.log('[HTTP] Shared community bot disconnected');
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: true }));
                } catch (e: any) {
                    console.error('[HTTP] Shared community bot disconnect failed:', e);
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: e.message }));
                }
                return;
            }
            
            if (pathname === '/api/brb' && req.method === 'POST') {
                let body = '';
                req.on('data', chunk => body += chunk);
                req.on('end', async () => {
                    try {
                        const { action, broadcasterUsername, tenantId } = JSON.parse(body);
                        if (action === 'start') {
                            const { startBRB } = require('../services/brb-clips');
                            startBRB(broadcasterUsername, tenantId).catch((err: any) => console.error('[BRB] Error:', err));
                            res.writeHead(200, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ success: true }));
                        } else if (action === 'stop') {
                            const { stopBRB } = require('../services/brb-clips');
                            stopBRB(tenantId);
                            broadcast({ type: 'brb-stop' }, tenantId);
                            try {
                                const { getConfigSection } = require('../lib/local-config/service');
                                const obsConfig = await getConfigSection('obs', tenantId);
                                const liveScene = obsConfig?.scenes?.live || 'Live';
                                broadcast({ type: 'obs-switch-scene', payload: { sceneName: liveScene } }, tenantId);
                            } catch {}
                            res.writeHead(200, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ success: true }));
                        } else {
                            res.writeHead(400, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ error: 'Invalid action' }));
                        }
                    } catch (e: any) {
                        console.error('[HTTP /api/brb] Error:', e);
                        res.writeHead(500, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: e.message }));
                    }
                });
                return;
            }

            if (pathname === '/' && req.method === 'GET') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ 
                    status: 'StreamWeaver Server Running',
                    version: '2.0',
                    websocket: getStatusWebSocketUrl(),
                    timestamp: new Date().toISOString()
                }));
                return;
            }
            
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Not found' }));
        } catch (error) {
            console.error('[HTTP Server] Error:', error);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Internal server error' }));
        }
    };
}
