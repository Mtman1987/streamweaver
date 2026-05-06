import * as http from 'http';
import * as url from 'url';
import { resolve } from 'path';
import { promises as fs } from 'fs';
import { validateLocalApiKeySync } from '../lib/local-config/service';
import { getConfiguredAppUrl, isAllowedOrigin } from '../lib/runtime-origin';

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

export function createHttpHandler(broadcast: (message: object, tenantId?: string) => void): http.RequestListener {
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
                        const { message, as, targetChannel, tenantId: requestedTenantId } = JSON.parse(body);
                        
                        if (message.startsWith('[Discord]')) {
                            const discordChannelsPath = resolve(process.cwd(), 'tokens', 'discord-channels.json');
                            try {
                                const channelsData = await fs.readFile(discordChannelsPath, 'utf-8');
                                const channels = JSON.parse(channelsData);
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
                        console.log(`[HTTP /api/twitch/send-message] Requesting client type: ${clientType}`);
                        
                        // Resolve tenant in strict order:
                        // 1) explicit tenantId from caller
                        // 2) targetChannel mapping
                        // 3) single-tenant fallback only when exactly one tenant is active
                        const channel = targetChannel || process.env.TWITCH_BROADCASTER_USERNAME || '';
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
                        
                        // Safety fallback for legacy single-tenant mode only.
                        if (!client) {
                            const tenantIds = getActiveTenantIds();
                            if (tenantIds.length === 1) {
                                tid = tenantIds[0];
                                client = getTc(clientType, tid);
                                console.log(`[HTTP /api/twitch/send-message] Using single-tenant fallback: ${tid}`);
                            }
                        }
                        
                        // Last-resort legacy fallback to preserve existing behavior for older call sites.
                        if (!client) {
                            const tenantIds = getActiveTenantIds();
                            for (const tenantId of tenantIds) {
                                client = getTc(clientType, tenantId);
                                if (client) {
                                    tid = tenantId;
                                    console.warn(`[HTTP /api/twitch/send-message] Using legacy multi-tenant fallback (tenant=${tenantId}). Caller should provide tenantId or targetChannel.`);
                                    break;
                                }
                            }
                        }

                        if (!client) {
                            console.error(`[HTTP /api/twitch/send-message] ${clientType} client is null/undefined`);
                            res.writeHead(500, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ error: `${clientType} client not available` }));
                            return;
                        }
                        
                        console.log(`[HTTP /api/twitch/send-message] Client username: ${(client as any).getUsername()}`);
                        
                        const sendChannel = targetChannel || '';
                        
                        // If no target channel specified, use the client's connected channel
                        const finalChannel = sendChannel || (client.getChannels?.()[0]?.replace('#', '') || '');
                        
                        await sendWithSharedChatAwareness({
                            client,
                            channel: finalChannel,
                            message,
                            as: clientType,
                            tenantId: tid,
                        });
                        
                        console.log(`[HTTP /api/twitch/send-message] Message sent successfully as ${clientType}`);
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
                            stopBRB();
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
