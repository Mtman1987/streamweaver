import { TIMEOUTS } from '../constants';
import { WebSocket } from 'ws';
import { getStoredTokens, ensureValidToken } from '../lib/token-utils.server';
import { sendChatMessage } from './twitch';
import { getCheckinSource, type CheckinKind } from './checkin-sources';
import { formatCheckinList, createPendingPayload, runCheckin, runBulkCheckin } from './checkin-flow';

import { getConfigValue } from '../lib/app-config';
import { getConfigSection } from '../lib/local-config/service';

const eventSubSockets = new Map<string, WebSocket>();

async function resolvePointsCtx(tenantId?: string): Promise<{ tenantId: string; username: string } | undefined> {
    if (!tenantId) return undefined;
    try {
        const tokens = await getStoredTokens(tenantId);
        return { tenantId, username: tokens?.broadcasterUsername || '' };
    } catch {
        return { tenantId, username: '' };
    }
}
const eventSubReconnectTimeouts = new Map<string, NodeJS.Timeout>();
const recentChatMessages = new Map<string, { message: string; timestamp: number }>();

type PendingCheckin = {
    timestamp: number;
    kind: CheckinKind;
    pointCost: number;
};

function tenantKey(tenantId?: string): string {
    return tenantId || 'global';
}

function userMessageKey(username: string, tenantId?: string): string {
    return `${tenantKey(tenantId)}:${username.toLowerCase()}`;
}

async function getBroadcasterAuth(tenantId?: string): Promise<{ clientId: string; accessToken: string; broadcasterId: string } | null> {
    // Get tokens from OAuth (not env)
    const tokens = await getStoredTokens(tenantId);
    if (!tokens) {
        console.warn(`[EventSub:${tenantId || 'global'}] No OAuth tokens found - please authenticate via dashboard`);
        return null;
    }

    // Use client ID from tokens, not env
    const clientId = tokens.twitchClientId || process.env.TWITCH_CLIENT_ID;
    const clientSecret = process.env.TWITCH_CLIENT_SECRET; // Only keep secret in env
    
    if (!clientId || !clientSecret) {
        console.warn('[EventSub] Missing credentials - clientId:', !!clientId, 'clientSecret:', !!clientSecret);
        return null;
    }

    const accessToken = await ensureValidToken(clientId, clientSecret, 'broadcaster', tokens, tenantId);
    
    // Get broadcaster ID from token validation
    const res = await fetch('https://id.twitch.tv/oauth2/validate', {
        headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
        console.warn('[EventSub] Token validation failed');
        return null;
    }
    const data = await res.json() as any;
    const broadcasterId = data.user_id;
    
    if (!broadcasterId) {
        console.warn('[EventSub] No user_id in token validation');
        return null;
    }
    
    return { clientId, accessToken, broadcasterId };
}

async function getBroadcasterTokenScopes(auth: { accessToken: string }): Promise<string[] | null> {
    const res = await fetch('https://id.twitch.tv/oauth2/validate', {
        headers: { Authorization: `Bearer ${auth.accessToken}` },
    });
    if (!res.ok) return null;
    const data = await res.json().catch(() => null) as any;
    return Array.isArray(data?.scopes) ? data.scopes : [];
}

async function deleteExistingChannelPointSubscriptions(auth: { clientId: string; accessToken: string; broadcasterId: string }): Promise<void> {
    try {
        const res = await fetch('https://api.twitch.tv/helix/eventsub/subscriptions?first=100', {
            headers: {
                'Client-ID': auth.clientId,
                Authorization: `Bearer ${auth.accessToken}`,
            },
        });
        if (!res.ok) {
            const text = await res.text();
            console.warn('[EventSub] Failed to list subscriptions:', res.status, text);
            return;
        }
        const data = await res.json() as any;
        const subs = Array.isArray(data?.data) ? data.data : [];
        const matches = subs.filter((s: any) =>
            s?.type === 'channel.channel_points_custom_reward_redemption.add' &&
            String(s?.condition?.broadcaster_user_id || '') === String(auth.broadcasterId)
        );

        for (const sub of matches) {
            const id = String(sub?.id || '');
            if (!id) continue;
            const del = await fetch(`https://api.twitch.tv/helix/eventsub/subscriptions?id=${encodeURIComponent(id)}`, {
                method: 'DELETE',
                headers: {
                    'Client-ID': auth.clientId,
                    Authorization: `Bearer ${auth.accessToken}`,
                },
            });
            if (del.ok) {
                console.log('[EventSub] Deleted old channel point subscription:', id);
            } else {
                const text = await del.text();
                console.warn('[EventSub] Failed to delete subscription:', id, del.status, text);
            }
        }
    } catch (error) {
        console.warn('[EventSub] Error deleting old subscriptions:', error);
    }
}

async function createChannelPointSubscription(auth: { clientId: string; accessToken: string; broadcasterId: string }, sessionId: string): Promise<void> {
    const body = {
        type: 'channel.channel_points_custom_reward_redemption.add',
        version: '1',
        condition: {
            broadcaster_user_id: auth.broadcasterId,
        },
        transport: {
            method: 'websocket',
            session_id: sessionId,
        },
    };

    console.log('[EventSub] Creating subscription with body:', JSON.stringify(body, null, 2));

    const res = await fetch('https://api.twitch.tv/helix/eventsub/subscriptions', {
        method: 'POST',
        headers: {
            'Client-ID': auth.clientId,
            Authorization: `Bearer ${auth.accessToken}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
    });

    if (!res.ok) {
        const text = await res.text();
        console.warn('[EventSub] Failed to create channel point subscription:', res.status, text);
        return;
    }

    const data = await res.json().catch(() => null) as any;
    const createdId = data?.data?.[0]?.id;
    console.log('[EventSub] Channel point subscription created:', createdId || '(unknown id)', 'Response:', JSON.stringify(data, null, 2));
}

export async function logBroadcasterTokenScopes(tenantId?: string): Promise<void> {
    try {
        const auth = await getBroadcasterAuth(tenantId);
        if (!auth) return;
        const scopes = await getBroadcasterTokenScopes(auth);
        if (!scopes) {
            console.warn('[EventSub] Token validate failed');
            return;
        }
        console.log('[EventSub] Broadcaster token scopes:', scopes.join(', ') || '(none)');
    } catch (error) {
        console.warn('[EventSub] Failed to validate token scopes:', error);
    }
}

export async function startEventSub(tenantId?: string, url = 'wss://eventsub.wss.twitch.tv/ws'): Promise<void> {
    const tKey = tenantKey(tenantId);
    const existingSocket = eventSubSockets.get(tKey);
    if (existingSocket) {
        try { existingSocket.close(); } catch { /* ignore */ }
        eventSubSockets.delete(tKey);
    }

    const auth = await getBroadcasterAuth(tenantId);
    if (!auth) return;

    const scopes = await getBroadcasterTokenScopes(auth);
    if (!scopes) {
        console.warn('[EventSub] Cannot validate broadcaster token');
        return;
    }
    
    const hasRedemptionsScope = scopes.includes('channel:read:redemptions') || scopes.includes('channel:manage:redemptions');
    if (!hasRedemptionsScope) {
        console.warn('[EventSub] Missing channel point scope');
        return;
    }

    console.log(`[EventSub:${tKey}] Connecting:`, url);
    const socket = new WebSocket(url);
    eventSubSockets.set(tKey, socket);

    socket.on('open', () => {
        console.log(`[EventSub:${tKey}] Socket open`);
    });

    socket.on('close', (code, reason) => {
        console.warn(`[EventSub:${tKey}] Socket closed:`, code, reason?.toString?.() || '');
        const current = eventSubSockets.get(tKey);
        if (current === socket) {
            eventSubSockets.delete(tKey);
        }
        scheduleEventSubReconnect('wss://eventsub.wss.twitch.tv/ws', 3000, tenantId);
    });

    socket.on('error', (err) => {
        console.warn(`[EventSub:${tKey}] Socket error:`, err);
    });

    socket.on('message', async (raw) => {
        try {
            const msg = JSON.parse(raw.toString());
            const messageType = msg?.metadata?.message_type;

            if (messageType === 'session_welcome') {
                const sessionId = msg?.payload?.session?.id;
                if (!sessionId) return;
                console.log(`[EventSub:${tKey}] Session established:`, sessionId);
                
                // Clean up old subscriptions and create new one
                await deleteExistingChannelPointSubscriptions(auth);
                await createChannelPointSubscription(auth, sessionId);
                return;
            }

            if (messageType === 'session_reconnect') {
                const reconnectUrl = msg?.payload?.session?.reconnect_url;
                if (typeof reconnectUrl === 'string' && reconnectUrl.startsWith('wss://')) {
                    console.log(`[EventSub:${tKey}] Reconnect requested`);
                    scheduleEventSubReconnect(reconnectUrl, 500, tenantId);
                }
                return;
            }

            if (messageType === 'notification') {
                const subType = msg?.payload?.subscription?.type;
                if (subType === 'channel.channel_points_custom_reward_redemption.add') {
                    const event = msg?.payload?.event;
                    if (event) {
                        // Log the full event for debugging
                        console.log('[EventSub] Full event data:', JSON.stringify(event, null, 2));
                        
                        const rewardTitle = String(event?.reward?.title || '');
                        const userLogin = String(event?.user_login || '');
                        const userInput = String(event?.user_input || '').trim();
                        console.log(`[EventSub] Channel point redeem: ${rewardTitle} by ${userLogin}, input: "${userInput}"`);
                        
                        // Load redeems config to match reward titles
                        let redeemsConfig;
                        try {
                            redeemsConfig = await getConfigSection('redeems', tenantId);
                            console.log('[EventSub] Loaded redeems config:', JSON.stringify(redeemsConfig));
                        } catch (cfgErr) {
                            console.error('[EventSub] Failed to load redeems config:', cfgErr);
                            return;
                        }

                        const checkinRewardMap: Array<{ kind: CheckinKind; rewardTitle: string; pointCost: number }> = [
                            { kind: 'partner', rewardTitle: redeemsConfig.partnerCheckin.rewardTitle, pointCost: redeemsConfig.partnerCheckin.pointCost },
                            { kind: 'crew', rewardTitle: redeemsConfig.crewCheckin.rewardTitle, pointCost: redeemsConfig.crewCheckin.pointCost },
                            { kind: 'mod', rewardTitle: redeemsConfig.modCheckin.rewardTitle, pointCost: redeemsConfig.modCheckin.pointCost },
                            { kind: 'space-mountain', rewardTitle: redeemsConfig.spaceMountainCheckin.rewardTitle, pointCost: redeemsConfig.spaceMountainCheckin.pointCost },
                        ];

                        const matchedCheckin = checkinRewardMap.find((entry) => entry.rewardTitle && rewardTitle.toLowerCase().includes(entry.rewardTitle.toLowerCase()));
                        if (matchedCheckin) {
                            try {
                                const checkinPointCost = matchedCheckin.pointCost;
                                if (checkinPointCost > 0) {
                                    const { getUserPoints } = require('./points');
                                    const pts = await getUserPoints(userLogin, await resolvePointsCtx(tenantId));
                                    if (pts < checkinPointCost) {
                                        sendChatMessage(`@${userLogin}, you need ${checkinPointCost} points for this check-in! (You have ${pts})`, 'broadcaster', undefined, tenantId).catch(() => {});
                                        return;
                                    }
                                }
                                const source = await getCheckinSource(matchedCheckin.kind, tenantId, userLogin);

                                if (matchedCheckin.kind === 'space-mountain') {
                                    runBulkCheckin('space-mountain', userLogin, matchedCheckin.pointCost, tenantId).catch(err => {
                                        console.error('[EventSub] Space Mountain check-in error:', err);
                                        fallbackCheckinCommand('space-mountain', userLogin, tenantId);
                                    });
                                    return;
                                }

                                if (source.entries.length > 0) {
                                    sendChatMessage(formatCheckinList(matchedCheckin.kind, source.entries), 'broadcaster', undefined, tenantId).catch(() => {});
                                }

                                // Check for recent chat message or text input
                                const recentMsgKey = userMessageKey(userLogin, tenantId);
                                const recentMsg = recentChatMessages.get(recentMsgKey);
                                const now = Date.now();
                                let squareNum: number | null = null;

                                if (recentMsg && (now - recentMsg.timestamp) < 5000) {
                                    squareNum = parseInt(recentMsg.message.trim(), 10);
                                    recentChatMessages.delete(recentMsgKey);
                                } else if (userInput) {
                                    squareNum = parseInt(userInput, 10);
                                }

                                if (!squareNum || isNaN(squareNum) || squareNum < 1) {
                                    let tenantSelections = pendingCheckins.get(tKey);
                                    if (!tenantSelections) {
                                        tenantSelections = new Map();
                                        pendingCheckins.set(tKey, tenantSelections);
                                    }
                                    tenantSelections.set(userLogin.toLowerCase(), { timestamp: Date.now(), kind: matchedCheckin.kind, pointCost: matchedCheckin.pointCost });
                                    if ((global as any).broadcast) {
                                        (global as any).broadcast({ type: 'checkin-pending', payload: createPendingPayload(matchedCheckin.kind, userLogin, source.sourceLabel) }, tenantId);
                                    }
                                    console.log(`[EventSub] Waiting for ${userLogin} to type a ${matchedCheckin.kind} number...`);
                                    return;
                                }

                                console.log(`[EventSub] ${matchedCheckin.kind} check-in: ${userLogin} selected square ${squareNum}`);
                                runCheckin(matchedCheckin.kind, userLogin, squareNum, matchedCheckin.pointCost, tenantId).catch(err => {
                                    console.error('[EventSub] Check-in handler error:', err);
                                    fallbackCheckinCommand(matchedCheckin.kind, userLogin, tenantId);
                                });
                            } catch (err) {
                                console.error(`[EventSub] Checkin handler failed for ${matchedCheckin.kind}, using fallback:`, err);
                                fallbackCheckinCommand(matchedCheckin.kind, userLogin, tenantId);
                            }
                            return;
                        }
                        
                        // Handle Pokemon pack redemptions
                        const pokeTitle = redeemsConfig.pokePack.rewardTitle;
                        console.log(`[EventSub] Checking PokePack: pokeTitle="${pokeTitle}", rewardTitle="${rewardTitle}", match=${pokeTitle ? rewardTitle.toLowerCase().includes(pokeTitle.toLowerCase()) : false}`);
                        if (pokeTitle && rewardTitle.toLowerCase().includes(pokeTitle.toLowerCase())) {
                            console.log('[EventSub] PokePack matched! Checking points first...');
                            const packPointCost = redeemsConfig.pokePack.pointCost;
                            if (packPointCost > 0) {
                                const { getUserPoints } = require('./points');
                                const pts = await getUserPoints(userLogin, await resolvePointsCtx(tenantId));
                                if (pts < packPointCost) {
                                    sendChatMessage(`@${userLogin}, you need ${packPointCost} points to open a pack! (You have ${pts})`, 'broadcaster', undefined, tenantId).catch(() => {});
                                    return;
                                }
                            }
                            const { getEnabledSetMap, formatSetList } = require('./pokemon-packs');
                            const enabledSets = redeemsConfig.pokePack.enabledSets || ['base1','base2','base3','base4','base5','gym1'];
                            const setMap = getEnabledSetMap(enabledSets);
                            const setCount = Object.keys(setMap).length;
                            console.log(`[EventSub] PokePack tenant=${tenantId || 'global'} user=${userLogin} enabledSetCount=${enabledSets.length} availableSetCount=${setCount}`);

                            // Check for number from recent chat or input
                            const recentMsgKey = userMessageKey(userLogin, tenantId);
                            const recentMsg = recentChatMessages.get(recentMsgKey);
                            const now = Date.now();
                            let setNumber: number | null = null;

                            if (recentMsg && (now - recentMsg.timestamp) < 5000) {
                                setNumber = parseInt(recentMsg.message.trim(), 10);
                                recentChatMessages.delete(recentMsgKey);
                            } else if (userInput) {
                                setNumber = parseInt(userInput, 10);
                            }

                            if (!setNumber || isNaN(setNumber) || setNumber < 1 || setNumber > setCount) {
                                sendChatMessage(formatSetList(setMap), 'broadcaster', undefined, tenantId).catch(err => console.error('[EventSub] Failed to post set list:', err));
                                let tenantPackRedeems = pendingPackRedeems.get(tKey);
                                if (!tenantPackRedeems) {
                                    tenantPackRedeems = new Map();
                                    pendingPackRedeems.set(tKey, tenantPackRedeems);
                                }
                                tenantPackRedeems.set(userLogin.toLowerCase(), { timestamp: Date.now(), pointCost: redeemsConfig.pokePack.pointCost });
                                console.log(`[EventSub] Waiting for ${userLogin} to pick a pack set...`);
                                return;
                            }

                            handlePackOpen(userLogin, setNumber, redeemsConfig.pokePack.pointCost, tenantId).catch(err => {
                                console.error('[EventSub] Pack open error:', err);
                            });
                            return;
                        }

                        // Handle custom rewards (point cost gate + optional response)
                        const customRewards = redeemsConfig.customRewards || {};
                        const customMatch = Object.entries(customRewards).find(([title]) =>
                            rewardTitle.toLowerCase().includes(title.toLowerCase())
                        );
                        if (customMatch) {
                            const [matchedTitle, reward] = customMatch;
                            console.log(`[EventSub] Custom reward matched: "${matchedTitle}" (cost: ${reward.pointCost})`);
                            const { getUserPoints, addPoints } = require('./points');
                            const pointsCtx = await resolvePointsCtx(tenantId);

                            if (reward.pointCost > 0) {
                                const points = await getUserPoints(userLogin, pointsCtx);
                                if (points < reward.pointCost) {
                                    sendChatMessage(`@${userLogin}, you need ${reward.pointCost} points for that! (You have ${points})`, 'broadcaster', undefined, tenantId).catch(() => {});
                                    return;
                                }
                                await addPoints(userLogin, -reward.pointCost, `redeem:${matchedTitle}`, pointsCtx);
                            } else if (reward.pointCost < 0) {
                                await addPoints(userLogin, Math.abs(reward.pointCost), `redeem:${matchedTitle}`, pointsCtx);
                            }

                            if (reward.response) {
                                const msg = reward.response.replace(/{user}/g, userLogin);
                                sendChatMessage(msg, 'broadcaster', undefined, tenantId).catch(() => {});
                            } else if (reward.pointCost !== 0) {
                                const newBalance = await getUserPoints(userLogin, pointsCtx);
                                sendChatMessage(`@${userLogin} redeemed ${matchedTitle}! Balance: ${newBalance} pts`, 'broadcaster', undefined, tenantId).catch(() => {});
                            }
                        }
                    }
                }
            }
        } catch (error) {
            console.warn('[EventSub] Failed to process message:', error);
        }
    });
}

function scheduleEventSubReconnect(url: string, delayMs = 2000, tenantId?: string) {
    const tKey = tenantKey(tenantId);
    if (eventSubReconnectTimeouts.has(tKey)) return;
    
    // Exponential backoff with max delay
    const maxDelay = TIMEOUTS.RECONNECT_MAX_DELAY;
    const actualDelay = Math.min(delayMs < TIMEOUTS.RECONNECT_MIN_DELAY ? TIMEOUTS.RECONNECT_MIN_DELAY : delayMs, maxDelay);
    
    const timer = setTimeout(() => {
        eventSubReconnectTimeouts.delete(tKey);
        void startEventSub(tenantId, url);
    }, actualDelay);
    eventSubReconnectTimeouts.set(tKey, timer);
    
    console.log(`[EventSub:${tKey}] Scheduled reconnect in ${actualDelay}ms`);
}

// Pending partner check-ins: viewer redeemed but hasn't typed a number yet
export const pendingCheckins = new Map<string, Map<string, PendingCheckin>>();
export const pendingPackRedeems = new Map<string, Map<string, { timestamp: number; pointCost: number }>>();

// Export function to track chat messages for redemptions
export function trackChatMessageForRedemption(username: string, message: string, tenantId?: string): boolean {
    const key = username.toLowerCase();
    const tKey = tenantKey(tenantId);
    const msgKey = userMessageKey(username, tenantId);

    // If this user has a pending check-in and typed a number, fire it
    const tenantCheckins = pendingCheckins.get(tKey) || new Map();
    const pending = tenantCheckins.get(key);
    if (pending && Date.now() - pending.timestamp < 30000) {
        const num = parseInt(message.trim(), 10);
        if (num >= 1) {
            tenantCheckins.delete(key);
            runCheckin(pending.kind, username, num, pending.pointCost, tenantId).catch(err => {
                console.error('[EventSub] Pending check-in error:', err);
            });
            return true;
        }
    }

    // If this user has a pending pack redeem and typed a number, fire it
    const tenantPackRedeems = pendingPackRedeems.get(tKey) || new Map();
    const pendingPack = tenantPackRedeems.get(key);
    if (pendingPack && Date.now() - pendingPack.timestamp < 30000) {
        const num = parseInt(message.trim(), 10);
        if (num >= 1) {
            tenantPackRedeems.delete(key);
            handlePackOpen(username, num, pendingPack.pointCost, tenantId).catch(err => {
                console.error('[EventSub] Pending pack open error:', err);
            });
            return true;
        }
    }

    recentChatMessages.set(msgKey, {
        message,
        timestamp: Date.now()
    });
    
    // Clean up old messages after 10 seconds
    setTimeout(() => {
        const entry = recentChatMessages.get(msgKey);
        if (entry && Date.now() - entry.timestamp > 10000) {
            recentChatMessages.delete(msgKey);
        }
    }, 10000);

    return false;
}

export function isEventSubConnected(tenantId?: string): boolean {
    const tKey = tenantKey(tenantId);
    const socket = eventSubSockets.get(tKey);
    return socket?.readyState === WebSocket.OPEN;
}

const CHECKIN_COMMAND_MAP: Record<string, string> = {
    'partner': '!partner',
    'crew': '!crew',
    'mod': '!mod',
    'space-mountain': '!spacemountain',
};

export async function fallbackCheckinCommand(kind: string, username: string, tenantId?: string): Promise<void> {
    const cmd = CHECKIN_COMMAND_MAP[kind];
    if (!cmd) return;
    console.log(`[EventSub] Fallback: sending ${cmd} in chat for ${username}`);
    await sendChatMessage(`${cmd}`, 'broadcaster', undefined, tenantId).catch(() => {});
}

export { runCheckin as handlePartnerCheckinCmd };

export { handlePackOpen as handlePackOpenCmd };
async function handlePackOpen(username: string, setNumber: number, pointCost: number, tenantId?: string): Promise<void> {
    console.log(`[PokePack] ${username} opening set ${setNumber}`);
    try {
        const { openPack } = require('./pokemon-packs');
        const { getUserPoints, addPoints } = require('./points');
        const pointsCtx = await resolvePointsCtx(tenantId);

        if (pointCost > 0) {
            const points = await getUserPoints(username, pointsCtx);
            if (points < pointCost) {
                sendChatMessage(`@${username}, you need ${pointCost} points to open a pack! (You have ${points})`, 'broadcaster', undefined, tenantId).catch(() => {});
                return;
            }
            await addPoints(username, -pointCost, 'pokepack', pointsCtx);
        }

        const result = await openPack(setNumber, username, undefined, tenantId);

        if (!result) {
            if (pointCost > 0) {
                await addPoints(username, pointCost, 'pokepack-refund', pointsCtx);
                console.log(`[PokePack] Refunded ${pointCost} to ${username} (pack failed)`);
            }
            sendChatMessage(`@${username}, couldn't open that pack. Try a different set!`, 'broadcaster', undefined, tenantId).catch(() => {});
            return;
        }

        if (result) {
            const cardNames = result.pack.map((c: any) => {
                const star = (c.rarity === 'Rare' || c.rarity === 'Rare Holo') ? '⭐' : '';
                return `${star}${c.name}`;
            }).join(', ');
            const { getUserPoints: getBalance } = require('./points');
            const newBalance = await getBalance(username, pointsCtx);

            // 1. Broadcaster posts the card list + balance (chat mode only)
            const { getPokeMode } = require('./poke-mode');
            const pokeMode = getPokeMode(tenantId);
            if (pokeMode === 'chat') {
                await sendChatMessage(`@${username} opened a ${result.setName} pack: ${cardNames} | Balance: ${newBalance} pts`, 'broadcaster', undefined, tenantId);
            }

            // 2. AI reaction to the pack
            const rares = result.pack.filter((c: any) => c.rarity === 'Rare' || c.rarity === 'Rare Holo');
            const { getBotName: gbn2, getBotPersonality: gbp2 } = require('../lib/bot-settings-store');
            const botName = gbn2(tenantId);
            const botPersonality = gbp2(tenantId);
            let aiReaction = rares.length > 0
                ? `Nice pull, ${username}! You got ${rares.map((c: any) => c.name).join(' and ')}!`
                : `Good pack, ${username}! ${result.setName} cards added to your collection!`;

            const edenaiKey = process.env.EDENAI_API_KEY;
            if (edenaiKey) {
                try {
                    const rareList = rares.length > 0 ? `Notable pulls: ${rares.map((c: any) => `${c.name} (${c.rarity})`).join(', ')}` : 'No rare pulls this time.';
                    const resp = await fetch('https://api.edenai.run/v2/text/chat', {
                        method: 'POST',
                        headers: { 'Authorization': `Bearer ${edenaiKey}`, 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            providers: 'openai',
                            text: `You are ${botName}. ${username} just opened a ${result.setName} Pokemon card pack on stream. ${rareList} Write a short, excited 1-2 sentence reaction to their pull. If they got a rare or holo, hype it up! Stay in character.`,
                            chatbot_global_action: botPersonality,
                            temperature: 0.8,
                            max_tokens: 150,
                        }),
                    });
                    if (resp.ok) {
                        const data = await resp.json() as any;
                        const text = data.openai?.generated_text?.trim();
                        if (text) aiReaction = text;
                    }
                } catch (err) {
                    console.error('[PokePack] AI reaction failed, using fallback:', err);
                }
            }

            // 3. Post as bot with TTS (chat mode only)
            if (pokeMode === 'chat') {
                const { markTtsHandled } = require('./chat-dispatcher');
                markTtsHandled(aiReaction);
                await sendChatMessage(aiReaction, 'bot', undefined, tenantId);
            }

            if (pokeMode === 'chat') {
                try {
                    const { textToSpeech } = await import('../ai/flows/text-to-speech');
                const ttsResult = await textToSpeech({ text: aiReaction });
                if (ttsResult.audioDataUri) {
                    const useTTSPlayer = process.env.USE_TTS_PLAYER !== 'false';
                    if (useTTSPlayer) {
                        const tenantQuery = tenantId ? `?tenant=${encodeURIComponent(tenantId)}` : '';
                        await fetch(`http://127.0.0.1:${process.env.PORT||3100}/api/tts/current${tenantQuery}`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ audioUrl: ttsResult.audioDataUri }),
                        }).catch(() => {});
                    } else if ((global as any).broadcast) {
                        (global as any).broadcast({ type: 'play-tts', payload: { audioDataUri: ttsResult.audioDataUri } }, tenantId);
                    }
                }
            } catch (err: unknown) {
                console.error('[PokePack] TTS error:', err);
            }
            }
        }
    } catch (error) {
        console.error('[PokePack] Error:', error);
    }
}
