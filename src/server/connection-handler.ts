import { WebSocket } from 'ws';
import { getTwitchStatus } from '../services/twitch-client';
import { getCachedChatHistory, loadChatHistory } from '../services/chat-monitor';

export async function handleNewConnection(ws: WebSocket) {
    try {
        console.log('[ConnectionHandler] New client connected.');

        // 1. Send current Twitch status
        const status = getTwitchStatus();
        console.log(`[ConnectionHandler] Sending Twitch status to client: ${status}`);
        if (status) {
            ws.send(JSON.stringify({
                type: 'twitch-status',
                payload: { status }
            }));
        }

        // 2. Send whatever history we have in memory right now.
        const history = getCachedChatHistory();
        if (history && history.length > 0) {
            console.log(`[ConnectionHandler] Sending ${history.length} cached history items to new client.`);
            ws.send(JSON.stringify({
                type: 'chat-history',
                payload: history
            }));
        }

        // 3. Trigger a fresh load from Discord in the background.
        // The `loadChatHistory` function itself will broadcast the result to all clients.
        console.log('[ConnectionHandler] Triggering background refresh of chat history.');
        loadChatHistory().catch((e) => console.error('[ConnectionHandler] Background history refresh failed:', e));

    } catch (e) {
        // Use a try-catch to prevent a single bad client connection from crashing the server
        if (e instanceof Error && e.message.includes('not open')) {
            // This is a common, benign error if the client disconnects immediately.
        } else {
            console.error('[ConnectionHandler] Error during new connection setup:', e);
        }
    }
}