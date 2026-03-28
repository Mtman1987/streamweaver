import { validateConfiguration } from './src/lib/config-validator';
import { TIMEOUTS, PORTS } from './src/constants';
import { config } from 'dotenv';
config();
console.log('[Server] ALLOW_DATA_FILE_IO from .env:', process.env.ALLOW_DATA_FILE_IO);

import { applyUserConfigToProcessEnvSync } from './src/lib/user-config';
applyUserConfigToProcessEnvSync();

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

function broadcast(message: object) {
    if (wss && wss.clients) {
        let count = 0;
        wss.clients.forEach(client => {
            if (client.readyState === 1) { // WebSocket.OPEN
                client.send(JSON.stringify(message));
                count++;
            }
        });
        // console.log(`[WebSocket] Broadcasted message to ${count} clients`);
    }
}

// Add broadcast to global scope for flows
(global as any).broadcast = broadcast;
(global as any).botPersonality = "You are a helpful AI assistant.";
(global as any).botVoice = "Algieba";

async function startServer() {
    try {
        console.log('[StreamWeaver] Starting unified server...');

        // Ensure config exists and migrations are applied before services boot.
        await initializeLocalConfig();
        const appConfig = await getConfigSection('app');
        const isProductionRuntime = process.env.NODE_ENV === 'production';
        const serverHost = process.env.SERVER_HOST || (isProductionRuntime ? '0.0.0.0' : appConfig.server.host || '127.0.0.1');
        const uiPort = Number(process.env.PORT || appConfig.server.port || 3100);
        const wsPort = Number(process.env.WS_PORT || appConfig.server.wsPort || 8090);
        const nextPublicPort = String(uiPort);
        
        // Validate configuration
        const configResult = validateConfiguration();
        if (!configResult.isValid) {
            console.error('[Config] Configuration errors found:');
            configResult.errors.forEach(error => console.error(`  - ${error}`));
            process.exit(1);
        }
        if (configResult.warnings.length > 0) {
            console.warn('[Config] Configuration warnings:');
            configResult.warnings.forEach(warning => console.warn(`  - ${warning}`));
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
        console.log('[STEP 1] Starting Next.js...');
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
        
        // STEP 3: Initialize Twitch client
        console.log('[STEP 3] Initializing Twitch client...');
        try {
            const twitchModule = require('./src/services/twitch-client');
            const { setupTwitchClient, getTwitchClient } = twitchModule;
            // Pass broadcast function to Twitch client
            (global as any).broadcast = broadcast;
            await setupTwitchClient();
            twitchClient = getTwitchClient();
            console.log('[STEP 3] ✅ Twitch client ready');
        } catch (e) {
            console.warn('[STEP 3] ⚠️ Twitch client failed:', e);
        }
        
        // Ensure dispatcher module is loaded once during startup.
        try {
            require('./src/services/chat-dispatcher');
            console.log('[STEP 3.5] ✅ Chat dispatcher loaded');
        } catch (error) {
            console.error('[STEP 3.5] Chat dispatcher preload failed:', error);
        }

        // STEP 4: Initialize all services
        console.log('[STEP 4] Initializing services...');
        const { loadChatHistory } = require('./src/services/chat-monitor');
        const { startEventSub } = require('./src/services/eventsub');
        const { setupObsWebSocket } = require('./src/services/obs');

        const services = [
            { name: 'Chat History', fn: loadChatHistory },
            { name: 'EventSub', fn: startEventSub },
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
        const { checkChatActivity } = require('./src/services/chat-monitor');
        pollingService.addTask('chat-monitor', async () => {
            try { await checkChatActivity(); } catch (e) { /* silent */ }
        }, 10000);
        pollingService.addTask('twitch-live', async () => {
            try {
                const { checkTwitchLiveStatus } = require('./src/services/twitch');
                await checkTwitchLiveStatus();
            } catch (e) { /* silent */ }
        }, 60000);
        pollingService.addTask('metrics', async () => {
            try { const { updateMetrics } = require('./src/services/metrics'); await updateMetrics(); } catch (e) { /* silent */ }
        }, 120000);
        pollingService.addTask('points-sync', async () => {
            try { const { syncPointsData } = require('./src/services/points'); await syncPointsData(); } catch (e) { /* silent */ }
        }, 30000);
        pollingService.addTask('athena-bingo', async () => {
            try { const { athenaClaimCheck } = require('./src/services/bingo'); await athenaClaimCheck(); } catch (e) { /* silent */ }
        }, 5000); // Check every 5 seconds
        pollingService.addTask('watchtime-tracker', async () => {
            try {
                const resp = await fetch(`http://127.0.0.1:${uiPort}/api/chat/chatters`);
                if (resp.ok) {
                    const data = await resp.json() as any;
                    const names = (data.chatters || []).map((c: any) => c.user_login || c.user_name).filter(Boolean);
                    if (names.length > 0) {
                        const { incrementWatchtime } = require('./src/services/user-stats');
                        await incrementWatchtime(names);
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
