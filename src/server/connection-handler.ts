import { WebSocket } from 'ws';
import { getTwitchStatus } from '../services/twitch-client';
import { getCachedChatHistory, loadChatHistory } from '../services/chat-monitor';

export async function handleNewConnection(ws: WebSocket) {
    try {
        const tenantId = (ws as any).__tenantId;

        // 1. Send tenant-specific Twitch status (or disconnected until identify).
        const status = tenantId ? getTwitchStatus(tenantId) : 'disconnected';
        if (status) {
            ws.send(JSON.stringify({
                type: 'twitch-status',
                payload: { status }
            }));
        }

        // 2. Only send/load history after tenant context exists.
        if (!tenantId) {
            return;
        }

        const history = getCachedChatHistory(tenantId);
        if (history && history.length > 0) {
            console.log(`[ConnectionHandler] Sending ${history.length} cached history items for tenant ${tenantId} to new client.`);
            ws.send(JSON.stringify({
                type: 'chat-history',
                payload: history
            }));
        }

        // 3. Trigger a fresh load from Discord in the background.
        loadChatHistory(tenantId).catch((e) => console.error('[ConnectionHandler] Background history refresh failed:', e));

    } catch (e) {
        // Use a try-catch to prevent a single bad client connection from crashing the server
        if (e instanceof Error && e.message.includes('not open')) {
            // This is a common, benign error if the client disconnects immediately.
        } else {
            console.error('[ConnectionHandler] Error during new connection setup:', e);
        }
    }
}
