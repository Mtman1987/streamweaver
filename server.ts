import { validateConfiguration } from './src/lib/config-validator';
import { TIMEOUTS, PORTS } from './src/constants';
import { config } from 'dotenv';
config();
console.log('[Server] ALLOW_DATA_FILE_IO from .env:', process.env.ALLOW_DATA_FILE_IO);

import { applyUserConfigToProcessEnvSync } from './src/lib/user-config';
applyUserConfigToProcessEnvSync();

import { installRuntimeLogBuffer } from './src/services/runtime-log-buffer';
installRuntimeLogBuffer();

import * as http from 'http';
import { spawn } from 'child_process';
import { WebSocketServer } from 'ws';
import { PortManager } from './src/lib/port-manager';
import { waitForNextJsReady, waitForProcessOutput } from './src/lib/process-utils';
import { handleNewConnection } from './src/server/connection-handler';
import { getConfigSection, initializeLocalConfig } from './src/lib/local-config/service';


// Import additional services that need polling
let twitchClient: any = null;

const portManager = PortManager.getInstance();

let wss: WebSocketServer;
let httpServer: http.Server;
let nextJsProcess: any = null;
let genkitProcess: any = null;
let pollingService: any = null;

function broadcast(message: object, tenantId?: string) {
    if (wss && wss.clients) {
        let count = 0;
        wss.clients.forEach(client => {
            if (client.readyState === 1) { // WebSocket.OPEN
                const clientTenantId = (client as any).__tenantId;
                // If tenantId specified, only send to clients with matching tenantId
                if (tenantId) {
                    if (!clientTenantId || clientTenantId !== tenantId) {
                        return;
                    }
                }
                // If no tenantId specified, only send to clients without tenantId (for global messages)
                else if (clientTenantId) {
                    return;
                }
                client.send(JSON.stringify(message));
                count++;
            }
        });
    }
}

// Add broadcast to global scope for flows
(global as any).broadcast = broadcast;

async function startServer() {
    try {
        console.log('[StreamWeaver] Starting unified server...');
        console.log('[DEBUG] NODE_ENV:', process.env.NODE_ENV);
        console.log('[DEBUG] PORT:', process.env.PORT);
        console.log('[DEBUG] WS_PORT:', process.env.WS_PORT);
        console.log('[DEBUG] SERVER_HOST:', process.env.SERVER_HOST);

        // Ensure config exists and migrations are applied before services boot.
        let appConfig;
        try {
            await initializeLocalConfig();
            appConfig = await getConfigSection('app');
            console.log('[Config] ✅ Local config initialized successfully');
        } catch (error) {
            console.error('[Config] Failed to initialize local config:', error);
            // Create minimal fallback config
            appConfig = {
                server: {
                    host: '127.0.0.1',
                    port: 3100,
                    wsPort: 8090
                }
            };
            console.log('[Config] Using fallback configuration');
        }
        const isProductionRuntime = process.env.NODE_ENV === 'production';

        // Re-bootstrap all existing tenants (fills missing config/commands/actions)
        try {
            const { rebootstrapAllTenants, listTenants: listTenantsForMigration } = require('./src/lib/tenant');
            await rebootstrapAllTenants();
            // Migrate bic data from all tenants into global bic storage
            try {
                const { migrateFromAutomationVariables } = require('./src/services/bic-storage');
                const tenantIds = await listTenantsForMigration();
                for (const tid of tenantIds) await migrateFromAutomationVariables(tid);
                await migrateFromAutomationVariables(); // also check global
            } catch (e) { console.warn('[Server] Bic migration skipped:', e); }
        } catch (e) {
            console.warn('[Server] Tenant re-bootstrap failed:', e);
        }

        // Reset all bot share modes to off (safety: per-tenant scoping migration)
        try {
            const { resetAllBotShareModes } = require('./src/lib/bot-interactions-store');
            await resetAllBotShareModes();
            console.log('[Server] ✅ All bot share modes reset to off');
        } catch (e) {
            console.warn('[Server] Bot share mode reset skipped:', e);
        }

        const serverHost = process.env.SERVER_HOST || (isProductionRuntime ? '0.0.0.0' : appConfig?.server?.host || '127.0.0.1');
        const uiPort = Number(process.env.PORT || appConfig?.server?.port || (isProductionRuntime ? 3000 : 3100));
        const wsPort = Number(process.env.WS_PORT || appConfig?.server?.wsPort || 8090);
        const nextPublicPort = String(uiPort);
        
        console.log('[DEBUG] Final config - serverHost:', serverHost, 'uiPort:', uiPort, 'wsPort:', wsPort);
        
        // Validate configuration with timeout
        try {
            const configResult = validateConfiguration();
            if (!configResult.isValid) {
                console.error('[Config] Configuration errors found:');
                configResult.errors.forEach(error => console.error(`  - ${error}`));
                // Don't exit in production, just warn
                if (!isProductionRuntime) {
                    process.exit(1);
                }
            }
            if (configResult.warnings.length > 0) {
                console.warn('[Config] Configuration warnings:');
                configResult.warnings.forEach(warning => console.warn(`  - ${warning}`));
            }
        } catch (error) {
            console.warn('[Config] Configuration validation failed:', error);
        }
        
        // Check if port 8090 is available - try cleanup first if needed
        const requiredPort = parseInt(String(wsPort || PORTS.DEFAULT_WS), 10);
        if (await portManager.isPortInUse(requiredPort)) {
            console.log(`[Server] Port ${requiredPort} in use, attempting cleanup...`);
            await portManager.killProcessOnPort(requiredPort);
            await new Promise(resolve => setTimeout(resolve, TIMEOUTS.PROCESS_START_DELAY));
            
            if (await portManager.isPortInUse(requiredPort)) {
                console.error(`❌ Port ${requiredPort} still in use after cleanup!`);
                console.error('Please run: stop-streamweaver.bat');
                console.error('Then wait 5 seconds before trying again.');
                process.exit(1);
            }
        }
        
        process.env.WS_PORT = requiredPort.toString();
        console.log(`[Server] Using WebSocket port: ${requiredPort}`);
        
        // Check other ports with cleanup
        if (await portManager.isPortInUse(uiPort)) {
            console.log(`[Server] Port ${uiPort} in use, attempting cleanup...`);
            await portManager.killProcessOnPort(uiPort);
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        
        if (await portManager.isPortInUse(4000)) {
            console.log('[Server] Port 4000 in use, attempting cleanup...');
            await portManager.killProcessOnPort(4000);
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        
        if (await portManager.isPortInUse(4033)) {
            console.log('[Server] Port 4033 in use, attempting cleanup...');
            await portManager.killProcessOnPort(4033);
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        
        if (await portManager.isPortInUse(4001)) {
            console.log('[Server] Port 4001 in use, attempting cleanup...');
            await portManager.killProcessOnPort(4001);
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        
        // STEP 1: Start Next.js and wait for it to be ready
        console.log(`[STEP 1] Starting Next.js on ${serverHost}:${uiPort}...`);
        const nextCommand = isProductionRuntime ? 'next' : 'next';
        const nextArgs = isProductionRuntime
            ? ['start', '-p', String(uiPort), '-H', serverHost]
            : ['dev', '-p', String(uiPort), '-H', serverHost];

        nextJsProcess = spawn('npx', [nextCommand, ...nextArgs], {
            cwd: process.cwd(),
            env: {
                ...process.env,
                NODE_ENV: process.env.NODE_ENV || (isProductionRuntime ? 'production' : 'development'),
                HOSTNAME: serverHost,
                PORT: String(uiPort),
                NEXT_PUBLIC_STREAMWEAVE_PORT: nextPublicPort,
                NEXT_PUBLIC_STREAMWEAVE_WS_PORT: String(requiredPort),
                NEXT_PUBLIC_STREAMWEAVE_WS_HOST: serverHost,
            },
            stdio: ['pipe', 'pipe', 'pipe'],
            shell: true
        });
        
        nextJsProcess.stdout?.on('data', (data: Buffer) => {
            const output = data.toString().trim();
            if (output && !output.includes('GET /api/') && !output.includes('POST /api/')) {
                console.log(`[Next.js] ${output}`);
            }
        });
        
        nextJsProcess.stderr?.on('data', (data: Buffer) => {
            const output = data.toString().trim();
            if (output && !output.includes('FATAL: An unexpected Turbopack error') && !output.includes('next-panic')) {
                console.error(`[Next.js ERROR] ${output}`);
            }
        });
        
        nextJsProcess.on('exit', (code: number, signal: string) => {
            console.log(`[DEBUG] Next.js process exited with code ${code}, signal: ${signal}`);
            nextJsProcess = null;
        });
        
        nextJsProcess.on('error', (error: Error) => {
            console.error(`[DEBUG] Next.js process error:`, error);
        });
        
        // Wait for Next.js to be ready with longer timeout
        await waitForProcessOutput(nextJsProcess, 'Ready in|Local:', 60000);
        await waitForNextJsReady();
        console.log('[STEP 1] ✅ Next.js is ready');
        
        // STEP 2: Start WebSocket server
        console.log('[STEP 2] Starting WebSocket server...');
        const { createHttpHandler } = require('./src/server/routes');
        const { createWebSocketServer } = require('./src/server/websocket');

        httpServer = http.createServer(createHttpHandler(broadcast));
        wss = createWebSocketServer(httpServer, broadcast, [], {}, 'disconnected', twitchClient);
        
        // Store wss globally for tag announcements
        (global as any).wss = wss;
        
        // Fix: Ensure new clients get the actual current Twitch status immediately
        wss.on('connection', (ws: any) => {
            handleNewConnection(ws);
        });

        await new Promise<void>((resolve, reject) => {
            httpServer.on('error', (e: any) => {
                if (e.code === 'EADDRINUSE') {
                    console.error(`[Server] Port ${requiredPort} is already in use.`);
                }
                reject(e);
            });

            httpServer.listen(requiredPort, serverHost, () => {
                console.log(`[STEP 2] ✅ WebSocket server ready on port ${requiredPort}`);
                resolve();
            });
        });
        
        // STEP 3: Initialize Twitch clients for all tenants
        console.log('[STEP 3] Initializing Twitch clients for all tenants...');
        try {
            const { setupAllTenants } = require('./src/services/twitch-client');
            await setupAllTenants();
            console.log('[STEP 3] ✅ Twitch clients ready');
        } catch (e) {
            console.warn('[STEP 3] ⚠️ Twitch client setup failed:', e);
        }
        
        // Ensure dispatcher module is loaded once during startup.
        try {
            require('./src/services/chat-dispatcher');
            console.log('[STEP 3.5] ✅ Chat dispatcher loaded');
        } catch (error) {
            console.error('[STEP 3.5] Chat dispatcher preload failed:', error);
        }

        // STEP 3.6: Auto-connect Kick chat for tenants with stored tokens
        console.log('[STEP 3.6] Auto-connecting Kick chat...');
        try {
            const { listTenants: listTenantsForKick } = require('./src/lib/tenant');
            const { tenantPath: kickTenantPath } = require('./src/lib/tenant');
            const { getMultiPlatformManager } = require('./src/services/multi-platform');
            const fsKick = require('fs').promises;

            // Register global connect function for API routes to call
            (global as any).__kickConnect = async (channelName: string, tenantId?: string) => {
                const mp = getMultiPlatformManager();
                await mp.connectKick(channelName, tenantId);
                console.log(`[Kick] ✅ Connected via API trigger: ${channelName}`);
            };

            const kickTenants = await listTenantsForKick();
            for (const tid of kickTenants) {
                try {
                    const tokensFile = kickTenantPath(tid, 'tokens/kick-tokens.json');
                    const data = JSON.parse(await fsKick.readFile(tokensFile, 'utf-8'));

                    // Resolve missing username/channelId/chatroomId from token (if token available)
                    if (data.broadcasterToken && (!data.broadcasterUsername || !data.broadcasterChatroomId)) {
                        try {
                            const chRes = await fetch('https://api.kick.com/public/v1/channels', {
                                headers: { 'Authorization': `Bearer ${data.broadcasterToken}` },
                            });
                            if (chRes.ok) {
                                const chData = await chRes.json();
                                const ch = chData.data?.[0];
                                if (ch) {
                                    data.broadcasterUsername = ch.slug || data.broadcasterUsername;
                                    data.broadcasterChannelId = String(ch.broadcaster_user_id || '');
                                    data.broadcasterChatroomId = String(ch.broadcaster_user_id || '');
                                    await fsKick.writeFile(tokensFile, JSON.stringify(data, null, 2));
                                    console.log(`[STEP 3.6] Resolved Kick info for ${tid}: ${data.broadcasterUsername} (${data.broadcasterChannelId})`);
                                }
                            }
                        } catch {}
                    }

                    // Connect if we have username + chatroomId (token not required for listening)
                    if (data.broadcasterUsername && data.broadcasterChatroomId) {
                        const mp = getMultiPlatformManager();
                        await mp.connectKick(data.broadcasterUsername, tid);
                        console.log(`[STEP 3.6] ✅ Kick connected for ${data.broadcasterUsername}`);
                    }
                } catch {}
            }
        } catch (e) {
            console.warn('[STEP 3.6] ⚠️ Kick auto-connect failed:', e);
        }

        // Connect to community Kick channels (players without StreamWeaver)
        try {
            const { getMultiPlatformManager } = require('./src/services/multi-platform');
            const COMMUNITY_KICK_CHANNELS: string[] = [];
            for (const slug of COMMUNITY_KICK_CHANNELS) {
                try {
                    const mp = getMultiPlatformManager();
                    await mp.connectKick(slug, `kick_community_${slug}`);
                    console.log(`[STEP 3.6] ✅ Kick community channel connected: ${slug}`);
                } catch (e: any) {
                    console.warn(`[STEP 3.6] ⚠️ Kick community connect failed for ${slug}:`, e.message);
                }
            }
        } catch (e) {
            console.warn('[STEP 3.6] ⚠️ Community Kick channels failed:', e);
        }

        // STEP 4: Initialize all services
        console.log('[STEP 4] Initializing services...');
        const { loadChatHistory } = require('./src/services/chat-monitor');
        const { startEventSub } = require('./src/services/eventsub');
        const { setupObsWebSocket } = require('./src/services/obs');
        const { loadWelcomeSession } = require('./src/services/welcome-wagon');
        const { listTenants } = require('./src/lib/tenant');

        const tenants = await listTenants();

        // Load welcome session for all tenants
        for (const tenantId of tenants) {
            try {
                await loadWelcomeSession(tenantId);
                console.log(`[STEP 4] ✅ Welcome session loaded for tenant ${tenantId}`);
            } catch (e) {
                console.warn(`[STEP 4] ⚠️ Welcome session load failed for tenant ${tenantId}:`, e);
            }
        }

        try {
            const { startWalkOnRecoveryScheduler } = require('./src/services/walk-on-recovery');
            startWalkOnRecoveryScheduler();
            console.log('[STEP 4] ✅ Walk-on recovery scheduler started');
        } catch (e) {
            console.warn('[STEP 4] ⚠️ Walk-on recovery scheduler failed:', e);
        }

        // Load chat history for all tenants
        console.log(`[STEP 4] Loading chat history for ${tenants.length} tenants...`);
        for (const tenantId of tenants) {
            try {
                await loadChatHistory(tenantId);
                console.log(`[STEP 4] ✅ Chat history loaded for tenant ${tenantId}`);
            } catch (e) {
                console.warn(`[STEP 4] ⚠️ Chat history failed for tenant ${tenantId}:`, e);
            }
        }

        const services = [
            { name: 'EventSub', fn: async () => {
                // Start EventSub for each tenant
                for (const tenantId of tenants) {
                    try {
                        await startEventSub(tenantId);
                        console.log(`[STEP 4] ✅ EventSub ready for tenant ${tenantId}`);
                    } catch (e) {
                        console.warn(`[STEP 4] ⚠️ EventSub failed for tenant ${tenantId}:`, e);
                    }
                }
            }},
            { name: 'OBS WebSocket', fn: setupObsWebSocket }
        ];
        
        for (const service of services) {
            try {
                await service.fn();
                console.log(`[STEP 4] ✅ ${service.name} ready`);
            } catch (e) {
                console.warn(`[STEP 4] ⚠️ ${service.name} failed:`, e);
            }
        }
        
        // STEP 5: Start polling
        console.log('[STEP 5] Starting polling services...');
        const pollingModule = require('./src/services/polling');
        pollingService = pollingModule.pollingService;
        const { checkChatActivity, checkDmChannelActivity, startDmChannelSweeper } = require('./src/services/chat-monitor');
        pollingService.addTask('chat-monitor', async () => {
            try { await checkChatActivity(); } catch (e) { /* silent */ }
        }, 10000);
        // Start the DM channel sweeper explicitly (no longer auto-started on import).
        try {
            startDmChannelSweeper();
            console.log('[STEP 5] ✅ DM channel sweeper started');
        } catch (e) {
            console.warn('[STEP 5] ⚠️ DM channel sweeper failed to start:', e);
        }
        pollingService.addTask('twitch-live', async () => {
            try {
                const { checkTwitchLiveStatus } = require('./src/services/twitch');
                await checkTwitchLiveStatus();
            } catch (e) { /* silent */ }
        }, 60000);
        pollingService.addTask('twitch-reconnect', async () => {
            try {
                const { reconnectDisconnectedTenants } = require('./src/services/twitch-client');
                await reconnectDisconnectedTenants();
            } catch (e) { /* silent */ }
        }, 300000); // every 5 minutes
        pollingService.addTask('kick-health', async () => {
            try {
                const { getAllKickInstances } = require('./src/services/kick');
                const instances = getAllKickInstances();
                for (const [tenantId, kick] of instances) {
                    if (tenantId === 'global') continue;
                    const connected = (kick as any).isConnected();
                    if (!connected && (kick as any).getChannelName()) {
                        console.log(`[Kick] ⚠️ Instance for tenant ${tenantId} disconnected, triggering reconnect...`);
                        const channelName = (kick as any).getChannelName();
                        try {
                            (kick as any).disconnect();
                            const { getMultiPlatformManager } = require('./src/services/multi-platform');
                            await getMultiPlatformManager().connectKick(channelName, tenantId);
                        } catch (e) { console.warn(`[Kick] Reconnect failed for ${tenantId}:`, e); }
                    }
                }
            } catch (e) { /* silent */ }
        }, 120000); // every 2 minutes
        pollingService.addTask('kick-token-refresh', async () => {
            try {
                const { listTenants: listTenantsForRefresh } = require('./src/lib/tenant');
                const { tenantPath: refreshTenantPath } = require('./src/lib/tenant');
                const fsRefresh = require('fs').promises;
                const clientId = process.env.KICK_CLIENT_ID;
                const clientSecret = process.env.KICK_CLIENT_SECRET;
                if (!clientId || !clientSecret) return;

                const tenantIds = await listTenantsForRefresh();
                for (const tid of tenantIds) {
                    try {
                        const tokensFile = refreshTenantPath(tid, 'tokens/kick-tokens.json');
                        const data = JSON.parse(await fsRefresh.readFile(tokensFile, 'utf-8'));
                        let changed = false;
                        const BUFFER = 10 * 60 * 1000; // refresh 10 min before expiry

                        // Refresh broadcaster token
                        if (data.broadcasterToken && data.broadcasterRefreshToken && data.broadcasterTokenExpiry) {
                            if (Date.now() >= (data.broadcasterTokenExpiry - BUFFER)) {
                                const res = await fetch('https://id.kick.com/oauth/token', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                                    body: new URLSearchParams({
                                        client_id: clientId, client_secret: clientSecret,
                                        grant_type: 'refresh_token', refresh_token: data.broadcasterRefreshToken,
                                    }),
                                });
                                if (res.ok) {
                                    const d = await res.json();
                                    data.broadcasterToken = d.access_token;
                                    if (d.refresh_token) data.broadcasterRefreshToken = d.refresh_token;
                                    data.broadcasterTokenExpiry = Date.now() + (d.expires_in - 60) * 1000;
                                    changed = true;
                                    console.log(`[Kick] ✅ Proactive refresh: broadcaster token for tenant ${tid}`);
                                }
                            }
                        }

                        // Refresh bot token
                        if (data.botToken && data.botRefreshToken && data.botTokenExpiry) {
                            if (Date.now() >= (data.botTokenExpiry - BUFFER)) {
                                const res = await fetch('https://id.kick.com/oauth/token', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                                    body: new URLSearchParams({
                                        client_id: clientId, client_secret: clientSecret,
                                        grant_type: 'refresh_token', refresh_token: data.botRefreshToken,
                                    }),
                                });
                                if (res.ok) {
                                    const d = await res.json();
                                    data.botToken = d.access_token;
                                    if (d.refresh_token) data.botRefreshToken = d.refresh_token;
                                    data.botTokenExpiry = Date.now() + (d.expires_in - 60) * 1000;
                                    changed = true;
                                    console.log(`[Kick] ✅ Proactive refresh: bot token for tenant ${tid}`);
                                }
                            }
                        }

                        if (changed) {
                            data.lastUpdated = new Date().toISOString();
                            await fsRefresh.writeFile(tokensFile, JSON.stringify(data, null, 2));
                        }
                    } catch {}
                }

                // Also refresh global bot token
                try {
                    const { globalPath: gp } = require('./src/lib/tenant');
                    const globalFile = gp('kick-bot-tokens.json');
                    const botData = JSON.parse(await fsRefresh.readFile(globalFile, 'utf-8'));
                    if (botData.accessToken && botData.refreshToken && botData.tokenExpiry) {
                        const BUFFER = 10 * 60 * 1000;
                        if (Date.now() >= (botData.tokenExpiry - BUFFER)) {
                            const res = await fetch('https://id.kick.com/oauth/token', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                                body: new URLSearchParams({
                                    client_id: clientId, client_secret: clientSecret,
                                    grant_type: 'refresh_token', refresh_token: botData.refreshToken,
                                }),
                            });
                            if (res.ok) {
                                const d = await res.json();
                                botData.accessToken = d.access_token;
                                if (d.refresh_token) botData.refreshToken = d.refresh_token;
                                botData.tokenExpiry = Date.now() + (d.expires_in - 60) * 1000;
                                await fsRefresh.writeFile(globalFile, JSON.stringify(botData, null, 2));
                                console.log('[Kick] ✅ Proactive refresh: global bot token');
                            }
                        }
                    }
                } catch {}
            } catch (e) { /* silent */ }
        }, 300000); // every 5 minutes
        pollingService.addTask('metrics', async () => {
            try { const { updateMetrics } = require('./src/services/metrics'); await updateMetrics(); } catch (e) { /* silent */ }
        }, 120000);
        pollingService.addTask('points-sync', async () => {
            try {
                const { syncPointsData } = require('./src/services/points');
                const { listTenants } = require('./src/lib/tenant');
                const { getStoredTokens } = require('./src/lib/token-utils.server');
                const tenantIds = await listTenants();
                for (const tid of tenantIds) {
                    const tokens = await getStoredTokens(tid);
                    const username = tokens?.broadcasterUsername || '';
                    if (!username) continue;
                    await syncPointsData({ tenantId: tid, username }).catch(() => {});
                }
            } catch (e) { /* silent */ }
        }, 30000);
        pollingService.addTask('watchtime-tracker', async () => {
            try {
                const { listTenants } = require('./src/lib/tenant');
                const { getStoredTokens } = require('./src/lib/token-utils.server');
                const tenantIds = await listTenants();
                for (const tid of tenantIds) {
                    const tokens = await getStoredTokens(tid);
                    const broadcasterUsername = tokens?.broadcasterUsername;
                    if (!broadcasterUsername) continue;
                    const resp = await fetch(`http://127.0.0.1:${uiPort}/api/chat/chatters?tenant=${tid}`);
                    if (resp.ok) {
                        const data = await resp.json() as any;
                        const names = (data.chatters || []).map((c: any) => c.user_login || c.user_name).filter(Boolean);
                        if (names.length > 0) {
                            const { incrementWatchtime } = require('./src/services/user-stats');
                            await incrementWatchtime(names, broadcasterUsername);
                        }
                    }
                }
            } catch (e) { /* silent */ }
        }, 60000); // Every 60 seconds = 1 minute of watchtime

        pollingService.start();
        console.log('[STEP 5] ✅ Polling services ready');
        
        // STEP 6: Skip Genkit (not needed for core functionality)
        console.log('[STEP 6] Skipping Genkit (not needed for core functionality)...');
        console.log('[STEP 6] ✅ Genkit skipped');
        
        console.log('🎉 ALL SERVICES READY - StreamWeaver fully started!');
        console.log(`📱 Dashboard: http://${serverHost}:${uiPort}`);
        console.log(`🔌 WebSocket: ws://${serverHost}:${requiredPort}`);
    } catch (error) {
        console.error('[Server] Failed to start:', error);
        await portManager.gracefulShutdown();
        process.exit(1);
    }
}

// Graceful shutdown
async function shutdown() {
    console.log('[StreamWeaver] Shutting down all services...');
    try {
        // Stop unified polling service
        if (pollingService) {
            pollingService.stop();
        }
        
        // Stop subprocesses first
        if (nextJsProcess) {
            console.log('[Next.js] Stopping...');
            nextJsProcess.kill('SIGTERM');
            nextJsProcess = null;
        }
        
        if (genkitProcess) {
            console.log('[Genkit] Stopping...');
            genkitProcess.kill('SIGTERM');
            genkitProcess = null;
        }
        
        // Stop WebSocket server
        if (wss) {
            await new Promise<void>((resolve) => {
                wss.close(() => {
                    console.log('[WebSocket] Stopped');
                    resolve();
});
});
        }

        // Stop HTTP server
        if (httpServer) {
            await new Promise<void>((resolve) => {
                httpServer.close(() => {
                    console.log('[HTTP Server] Stopped');
                    resolve();
                });
            });
        }
        
        // Cleanup ports
        await portManager.gracefulShutdown();
        
        console.log('[StreamWeaver] ✅ Shutdown complete');
        process.exit(0);
    } catch (error) {
        console.error('[StreamWeaver] Shutdown error:', error);
        process.exit(1);
    }
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('uncaughtException', (error) => {
    console.error('[Server] Uncaught Exception:', error);
});
process.on('unhandledRejection', (reason) => {
    console.error('[Server] Unhandled Rejection:', reason);
});

startServer();
