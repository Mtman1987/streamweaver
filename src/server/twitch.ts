import * as tmi from 'tmi.js';
import { getStoredTokens, ensureValidToken } from '../lib/token-utils.server';
import { StoredTokens } from '../lib/token-utils';
import { getUserTokens } from '../lib/firestore';

export async function createTwitchClient(
    broadcast: (message: object) => void,
    sendChatMessage: (text: string) => Promise<void>,
    handleWelcomeWagon: (username: string) => Promise<void>,
    awardChatPoints: (userId: string) => Promise<void>,
    incrementMetric: (key: string, amount?: number) => Promise<void>,
    automationEngine: any,
    userId?: string
): Promise<{ client: tmi.Client; status: string }> {
    let twitchStatus: 'connected' | 'disconnected' | 'connecting' = 'connecting';
    let warnedMissingBotAuth = false;
    
    let broadcasterUsername: string | undefined;
    let botUsername: string | undefined;
    let broadcasterOauthToken: string | undefined;
    let botOauthToken: string | undefined;
    
    const clientId = process.env.TWITCH_CLIENT_ID;
    const clientSecret = process.env.TWITCH_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
        console.error('[Twitch] Twitch client credentials not configured. Cannot proceed with token refresh.');
        twitchStatus = 'disconnected';
        broadcast({ type: 'twitch-status', payload: { status: 'disconnected', reason: 'Server configuration error.' } });
        throw new Error('Twitch credentials not configured');
    }

    try {
        let tokens: StoredTokens | null = null;
        if (userId) {
            tokens = await getUserTokens(userId);
        } else {
            tokens = await getStoredTokens();
        }

        if (tokens) {
            broadcasterUsername = tokens.broadcasterUsername;
            botUsername = tokens.botUsername;

            broadcasterOauthToken = await ensureValidToken(clientId, clientSecret, 'broadcaster', tokens);

            // Bot token is optional. Only attempt refresh if present.
            if (tokens.botToken && tokens.botRefreshToken) {
                botOauthToken = await ensureValidToken(clientId, clientSecret, 'bot', tokens);
            } else {
                if (!warnedMissingBotAuth) {
                    warnedMissingBotAuth = true;
                    console.warn('[Twitch] Bot token not configured yet; continuing with broadcaster auth only.');
                }
            }
        }
    } catch (error) {
        console.error('[Twitch] Error ensuring valid tokens:', error);
        twitchStatus = 'disconnected';
        broadcast({ type: 'twitch-status', payload: { status: 'disconnected', reason: 'Token refresh failed.' } });
        throw error;
    }

    // Validate required variables
    if (!broadcasterUsername || !broadcasterOauthToken) {
        console.error('[Twitch] Missing required credentials for Twitch chat connection.');
        twitchStatus = 'disconnected';
        broadcast({ type: 'twitch-status', payload: { status: 'disconnected', reason: 'Server configuration error.' } });
        throw new Error('Missing Twitch credentials');
    }

    // Always use broadcaster token and username for connection
    const chatToken = broadcasterOauthToken;
    const chatUsername = broadcasterUsername;

    console.log(`[Twitch] Attempting to connect to Twitch as '${chatUsername}' to join channel '${broadcasterUsername}'`);

    const twitchClient = new tmi.Client({
        options: { debug: false },
        identity: {
            username: chatUsername,
            password: `oauth:${chatToken.replace('oauth:', '')}`
        },
        channels: [ broadcasterUsername ]
    });

    // Add error event listener to catch authentication failures
    twitchClient.on('notice', (channel, msgid, message) => {
        console.log(`[Twitch] Notice: ${msgid} - ${message}`);
        if (String(msgid) === 'login_failure' || String(msgid) === 'invalid_oauth') {
            console.log('[Twitch] Authentication failed. This might be due to insufficient scopes on the broadcaster token.');
        }
    });

    // --- Twitch Event Listeners ---
    twitchClient.on('connected', (address, port) => {
        console.log(`[Twitch] ✅ Successfully connected to chat at ${address}:${port}`);
        twitchStatus = 'connected';
        broadcast({ type: 'twitch-status', payload: { status: 'connected' } });
    });

    twitchClient.on('disconnected', (reason) => {
        console.log(`[Twitch] ❌ Disconnected from chat: ${reason || 'Unknown reason'}`);
        twitchStatus = 'disconnected';
        broadcast({ type: 'twitch-status', payload: { status: 'disconnected', reason } });
        // Attempt to reconnect after a delay
        console.log('[Twitch] Attempting to reconnect in 5 seconds...');
        setTimeout(() => twitchClient.connect().catch(console.error), 5000);
    });
    
    // Message handling would be added here but it's quite large
    // For now, we'll keep it in the main server file
    
    return { client: twitchClient, status: twitchStatus };
}