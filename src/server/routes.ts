import * as http from 'http';
import * as url from 'url';
import { getStoredTokens } from '../lib/token-utils.server';
import { resolve } from 'path';
import { promises as fs } from 'fs';
import { validateLocalApiKeySync } from '../lib/local-config/service';

function isAllowedOrigin(origin: string | undefined): boolean {
    if (!origin) return true;
    try {
        const parsed = new URL(origin);
        return parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost';
    } catch {
        return false;
    }
}

function isAuthorized(headers: http.IncomingHttpHeaders): boolean {
    const key = headers['x-api-key'];
    const apiKey = Array.isArray(key) ? key[0] : key;
    return validateLocalApiKeySync(apiKey || '');
}

export function createHttpHandler(broadcast: (message: object) => void): http.RequestListener {
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
            res.setHeader('Access-Control-Allow-Origin', origin || 'http://127.0.0.1:3100');
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

                const tokens = await getStoredTokens();
                if (!tokens) {
                    res.writeHead(404, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'No tokens available' }));
                    return;
                }
                
                const authData = {
                    twitch: {
                        broadcasterUsername: tokens.broadcasterUsername,
                        botUsername: tokens.botUsername,
                        connected: Boolean(tokens.broadcasterToken || tokens.botToken)
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
                        const { message, as, targetChannel } = JSON.parse(body);
                        
                        // Check if this is a Discord bridge message and if bridge is disabled
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
                        
                        const { getTwitchClient } = await import('../services/twitch-client');
                        const { sendWithSharedChatAwareness } = await import('../services/shared-chat');
                        const clientType = as === 'broadcaster' ? 'broadcaster' : 'bot';
                        console.log(`[HTTP /api/twitch/send-message] Requesting client type: ${clientType}`);
                        const client = getTwitchClient(clientType);
                        
                        if (!client) {
                            console.error(`[HTTP /api/twitch/send-message] ${clientType} client is null/undefined`);
                            res.writeHead(500, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ error: `${clientType} client not available` }));
                            return;
                        }
                        
                        console.log(`[HTTP /api/twitch/send-message] Client username: ${(client as any).getUsername()}`);
                        
                        const channel = targetChannel || process.env.TWITCH_BROADCASTER_USERNAME || 'mtman1987';
                        
                        // Use shared-chat aware sending
                        await sendWithSharedChatAwareness({
                            client,
                            channel,
                            message,
                            as: clientType,
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
            
            // Health check endpoint
            if (pathname === '/api/__health' && req.method === 'GET') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 'ok' }));
                return;
            }
            
            // Root route - server status
            if (pathname === '/' && req.method === 'GET') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ 
                    status: 'StreamWeaver Server Running',
                    version: '2.0',
                    websocket: `ws://localhost:${process.env.WS_PORT || 8090}`,
                    timestamp: new Date().toISOString()
                }));
                return;
            }
            
            // 404 for unknown endpoints
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Not found' }));
        } catch (error) {
            console.error('[HTTP Server] Error:', error);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Internal server error' }));
        }
    };
}