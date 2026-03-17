import { TIMEOUTS } from '../constants';
import { WebSocket } from 'ws';
import { getStoredTokens, ensureValidToken } from '../lib/token-utils.server';
import { getPartnerById, getAllPartners } from './partner-checkin';
import { recordCheckin, getPartnerInviteLink } from './checkin-stats';
import { sendChatMessage } from './twitch';
import fetch from 'node-fetch';

import { getConfigValue } from '../lib/app-config';
import { getConfigSection } from '../lib/local-config/service';

let eventSubSocket: WebSocket | null = null;
let eventSubReconnectTimeout: NodeJS.Timeout | null = null;
const recentChatMessages = new Map<string, { message: string; timestamp: number }>();

async function getBroadcasterAuth(): Promise<{ clientId: string; accessToken: string; broadcasterId: string } | null> {
    // Get tokens from OAuth (not env)
    const tokens = await getStoredTokens();
    if (!tokens) {
        console.warn('[EventSub] No OAuth tokens found - please authenticate via dashboard');
        return null;
    }

    // Use client ID from tokens, not env
    const clientId = tokens.twitchClientId || process.env.TWITCH_CLIENT_ID;
    const clientSecret = process.env.TWITCH_CLIENT_SECRET; // Only keep secret in env
    
    if (!clientId || !clientSecret) {
        console.warn('[EventSub] Missing credentials - clientId:', !!clientId, 'clientSecret:', !!clientSecret);
        return null;
    }

    const accessToken = await ensureValidToken(clientId, clientSecret, 'broadcaster', tokens);
    
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

export async function logBroadcasterTokenScopes(): Promise<void> {
    try {
        const auth = await getBroadcasterAuth();
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

export async function startEventSub(url = 'wss://eventsub.wss.twitch.tv/ws'): Promise<void> {
    if (eventSubSocket) {
        try { eventSubSocket.close(); } catch { /* ignore */ }
        eventSubSocket = null;
    }

    const auth = await getBroadcasterAuth();
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

    console.log('[EventSub] Connecting:', url);
    eventSubSocket = new WebSocket(url);

    eventSubSocket.on('open', () => {
        console.log('[EventSub] Socket open');
    });

    eventSubSocket.on('close', (code, reason) => {
        console.warn('[EventSub] Socket closed:', code, reason?.toString?.() || '');
        scheduleEventSubReconnect('wss://eventsub.wss.twitch.tv/ws', 3000);
    });

    eventSubSocket.on('error', (err) => {
        console.warn('[EventSub] Socket error:', err);
    });

    eventSubSocket.on('message', async (raw) => {
        try {
            const msg = JSON.parse(raw.toString());
            const messageType = msg?.metadata?.message_type;

            if (messageType === 'session_welcome') {
                const sessionId = msg?.payload?.session?.id;
                if (!sessionId) return;
                console.log('[EventSub] Session established:', sessionId);
                
                // Clean up old subscriptions and create new one
                await deleteExistingChannelPointSubscriptions(auth);
                await createChannelPointSubscription(auth, sessionId);
                return;
            }

            if (messageType === 'session_reconnect') {
                const reconnectUrl = msg?.payload?.session?.reconnect_url;
                if (typeof reconnectUrl === 'string' && reconnectUrl.startsWith('wss://')) {
                    console.log('[EventSub] Reconnect requested');
                    scheduleEventSubReconnect(reconnectUrl, 500);
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
                            redeemsConfig = await getConfigSection('redeems');
                            console.log('[EventSub] Loaded redeems config:', JSON.stringify(redeemsConfig));
                        } catch (cfgErr) {
                            console.error('[EventSub] Failed to load redeems config:', cfgErr);
                            return;
                        }

                        // Handle Partner Check Ins
                        const partnerTitle = redeemsConfig.partnerCheckin.rewardTitle;
                        if (partnerTitle && rewardTitle.toLowerCase().includes(partnerTitle.toLowerCase())) {
                            const checkinPointCost = redeemsConfig.partnerCheckin.pointCost;
                            if (checkinPointCost > 0) {
                                const { getUserPoints } = require('./points');
                                const pts = await getUserPoints(userLogin);
                                if (pts < checkinPointCost) {
                                    sendChatMessage(`@${userLogin}, you need ${checkinPointCost} points for a partner check-in! (You have ${pts})`, 'broadcaster').catch(() => {});
                                    return;
                                }
                            }
                            const guildId = redeemsConfig.partnerCheckin.discordGuildId;
                            const roleName = redeemsConfig.partnerCheckin.discordRoleName;
                            const partners = await getAllPartners(guildId, roleName);

                            // Post the partner list so the viewer knows the numbers
                            if (partners.length > 0) {
                                const list = partners.map((p: any) => `${p.id}.${p.name}`).join(' ');
                                sendChatMessage(`Partner Check-Ins: ${list}`, 'broadcaster').catch(() => {});
                            }

                            // Check for recent chat message or text input
                            const recentMsg = recentChatMessages.get(userLogin.toLowerCase());
                            const now = Date.now();
                            let squareNum: number | null = null;

                            if (recentMsg && (now - recentMsg.timestamp) < 5000) {
                                squareNum = parseInt(recentMsg.message.trim(), 10);
                                recentChatMessages.delete(userLogin.toLowerCase());
                            } else if (userInput) {
                                squareNum = parseInt(userInput, 10);
                            }

                            if (!squareNum || isNaN(squareNum) || squareNum < 1) {
                                // No number yet — store pending redemption, wait for chat message
                                pendingPartnerCheckins.set(userLogin.toLowerCase(), { timestamp: Date.now(), guildId, roleName, pointCost: redeemsConfig.partnerCheckin.pointCost });
                                console.log(`[EventSub] Waiting for ${userLogin} to type a partner number...`);
                                return;
                            }

                            console.log(`[EventSub] Partner check-in: ${userLogin} selected square ${squareNum}`);
                            handlePartnerCheckin(userLogin, squareNum, guildId, roleName, redeemsConfig.partnerCheckin.pointCost).catch(err => {
                                console.error('[EventSub] Partner check-in handler error:', err);
                            });
                        }
                        
                        // Handle Pokemon pack redemptions
                        const pokeTitle = redeemsConfig.pokePack.rewardTitle;
                        console.log(`[EventSub] Checking PokePack: pokeTitle="${pokeTitle}", rewardTitle="${rewardTitle}", match=${pokeTitle ? rewardTitle.toLowerCase().includes(pokeTitle.toLowerCase()) : false}`);
                        if (pokeTitle && rewardTitle.toLowerCase().includes(pokeTitle.toLowerCase())) {
                            console.log('[EventSub] PokePack matched! Checking points first...');
                            const packPointCost = redeemsConfig.pokePack.pointCost;
                            if (packPointCost > 0) {
                                const { getUserPoints } = require('./points');
                                const pts = await getUserPoints(userLogin);
                                if (pts < packPointCost) {
                                    sendChatMessage(`@${userLogin}, you need ${packPointCost} points to open a pack! (You have ${pts})`, 'broadcaster').catch(() => {});
                                    return;
                                }
                            }
                            const { getEnabledSetMap, formatSetList } = require('./pokemon-packs');
                            const enabledSets = redeemsConfig.pokePack.enabledSets || ['base1','base2','base3','base4','base5','gym1'];
                            const setMap = getEnabledSetMap(enabledSets);
                            const setCount = Object.keys(setMap).length;
                            sendChatMessage(formatSetList(setMap), 'broadcaster').catch(err => console.error('[EventSub] Failed to post set list:', err));

                            // Check for number from recent chat or input
                            const recentMsg = recentChatMessages.get(userLogin.toLowerCase());
                            const now = Date.now();
                            let setNumber: number | null = null;

                            if (recentMsg && (now - recentMsg.timestamp) < 5000) {
                                setNumber = parseInt(recentMsg.message.trim(), 10);
                                recentChatMessages.delete(userLogin.toLowerCase());
                            } else if (userInput) {
                                setNumber = parseInt(userInput, 10);
                            }

                            if (!setNumber || isNaN(setNumber) || setNumber < 1 || setNumber > setCount) {
                                pendingPackRedeems.set(userLogin.toLowerCase(), { timestamp: Date.now(), pointCost: redeemsConfig.pokePack.pointCost });
                                console.log(`[EventSub] Waiting for ${userLogin} to pick a pack set...`);
                                return;
                            }

                            handlePackOpen(userLogin, setNumber, redeemsConfig.pokePack.pointCost).catch(err => {
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

                            if (reward.pointCost > 0) {
                                const points = await getUserPoints(userLogin);
                                if (points < reward.pointCost) {
                                    sendChatMessage(`@${userLogin}, you need ${reward.pointCost} points for that! (You have ${points})`, 'broadcaster').catch(() => {});
                                    return;
                                }
                                await addPoints(userLogin, -reward.pointCost, `redeem:${matchedTitle}`);
                            } else if (reward.pointCost < 0) {
                                await addPoints(userLogin, Math.abs(reward.pointCost), `redeem:${matchedTitle}`);
                            }

                            if (reward.response) {
                                const msg = reward.response.replace(/{user}/g, userLogin);
                                sendChatMessage(msg, 'broadcaster').catch(() => {});
                            } else if (reward.pointCost !== 0) {
                                const newBalance = await getUserPoints(userLogin);
                                sendChatMessage(`@${userLogin} redeemed ${matchedTitle}! Balance: ${newBalance} pts`, 'broadcaster').catch(() => {});
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

function scheduleEventSubReconnect(url: string, delayMs = 2000) {
    if (eventSubReconnectTimeout) return;
    
    // Exponential backoff with max delay
    const maxDelay = TIMEOUTS.RECONNECT_MAX_DELAY;
    const actualDelay = Math.min(delayMs < TIMEOUTS.RECONNECT_MIN_DELAY ? TIMEOUTS.RECONNECT_MIN_DELAY : delayMs, maxDelay);
    
    eventSubReconnectTimeout = setTimeout(() => {
        eventSubReconnectTimeout = null;
        void startEventSub(url);
    }, actualDelay);
    
    console.log(`[EventSub] Scheduled reconnect in ${actualDelay}ms`);
}

// Pending partner check-ins: viewer redeemed but hasn't typed a number yet
export const pendingPartnerCheckins = new Map<string, { timestamp: number; guildId: string; roleName: string; pointCost: number }>();
export const pendingPackRedeems = new Map<string, { timestamp: number; pointCost: number }>();

// Export function to track chat messages for redemptions
export function trackChatMessageForRedemption(username: string, message: string): boolean {
    const key = username.toLowerCase();

    // If this user has a pending partner check-in and typed a number, fire it
    const pending = pendingPartnerCheckins.get(key);
    if (pending && Date.now() - pending.timestamp < 30000) {
        const num = parseInt(message.trim(), 10);
        if (num >= 1) {
            pendingPartnerCheckins.delete(key);
            handlePartnerCheckin(username, num, pending.guildId, pending.roleName, pending.pointCost).catch(err => {
                console.error('[EventSub] Pending partner check-in error:', err);
            });
            return true;
        }
    }

    // If this user has a pending pack redeem and typed a number, fire it
    const pendingPack = pendingPackRedeems.get(key);
    if (pendingPack && Date.now() - pendingPack.timestamp < 30000) {
        const num = parseInt(message.trim(), 10);
        if (num >= 1) {
            pendingPackRedeems.delete(key);
            handlePackOpen(username, num, pendingPack.pointCost).catch(err => {
                console.error('[EventSub] Pending pack open error:', err);
            });
            return true;
        }
    }

    recentChatMessages.set(key, {
        message,
        timestamp: Date.now()
    });
    
    // Clean up old messages after 10 seconds
    setTimeout(() => {
        const entry = recentChatMessages.get(key);
        if (entry && Date.now() - entry.timestamp > 10000) {
            recentChatMessages.delete(key);
        }
    }, 10000);

    return false;
}

// Handle partner check-in with all integrations
export { handlePartnerCheckin as handlePartnerCheckinCmd };
async function handlePartnerCheckin(username: string, squareNum: number, guildId: string, roleName: string, pointCost: number): Promise<void> {
    console.log(`[Partner Checkin] START: ${username} -> square ${squareNum}`);
    
    try {
        // Check points if cost > 0
        if (pointCost > 0) {
            const { getUserPoints, addPoints: addPts } = require('./points');
            const points = await getUserPoints(username);
            if (points < pointCost) {
                sendChatMessage(`@${username}, you need ${pointCost} points for a partner check-in! (You have ${points})`, 'broadcaster').catch(() => {});
                return;
            }
            await addPts(username, -pointCost, 'partner-checkin');
        }

        const partner = await getPartnerById(squareNum, guildId, roleName);
        if (!partner) {
            console.error(`[Partner Checkin] Partner ${squareNum} not found`);
            return;
        }

        console.log(`[Partner Checkin] Found partner: ${partner.name}`);
        const partnerImageUrl = partner.avatarUrl;

        // Record stats
        const { recordCheckin: doRecord, getPartnerInviteLink: getInvite } = require('./checkin-stats');
        const stats = doRecord(username, partner.name);
        const inviteLink = getInvite(partner.discordUserId);

        // 1. Broadcaster announces the check-in with invite link and stats
        let broadcasterMsg = `@${username} just checked in using ${partner.name}'s check-in!`;
        if (inviteLink) broadcasterMsg += ` Join their Discord: ${inviteLink}`;
        broadcasterMsg += ` (${username}: ${stats.userTotal} check-ins | ${partner.name} community: ${stats.partnerTotal} total)`;
        if (pointCost > 0) {
            const { getUserPoints: getBalance } = require('./points');
            const newBalance = await getBalance(username);
            broadcasterMsg += ` | Balance: ${newBalance} pts`;
        }
        console.log('[Partner Checkin] Sending broadcaster message...');
        await sendChatMessage(broadcasterMsg, 'broadcaster');

        // 2. Generate AI greeting using bot personality
        const botName = (global as any).botName || 'StreamWeaver';
        const botPersonality = (global as any).botPersonality || 'You are a friendly, energetic AI co-host for a live stream.';
        let aiGreeting = `Welcome ${partner.name}! So glad you checked in!`;

        const edenaiKey = process.env.EDENAI_API_KEY;
        if (edenaiKey) {
            try {
                const resp = await fetch('https://api.edenai.run/v2/text/chat', {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${edenaiKey}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        providers: 'openai',
                        text: `You are ${botName}. A viewer named ${username} just checked in under stream partner ${partner.name}'s banner — one of our Space Mountain partners in our cosmic alliance. Write a short, heartfelt 1-2 sentence greeting welcoming ${username} and honoring ${partner.name}'s partnership. Use space/cosmic imagery. Stay fully in character.`,
                        chatbot_global_action: botPersonality,
                        temperature: 0.8,
                        max_tokens: 150,
                    }),
                });
                if (resp.ok) {
                    const data = await resp.json() as any;
                    const text = data.openai?.generated_text?.trim();
                    if (text) aiGreeting = text;
                }
            } catch (err) {
                console.error('[Partner Checkin] AI greeting failed, using fallback:', err);
            }
        }

        // 3. Mark TTS handled so dispatcher doesn't double-fire, then post as bot
        const { markTtsHandled } = require('./chat-dispatcher');
        markTtsHandled(aiGreeting);
        console.log('[Partner Checkin] Sending bot AI greeting...');
        await sendChatMessage(aiGreeting, 'bot');

        // 4. Generate and send TTS
        console.log('[Partner Checkin] Triggering TTS...');
        try {
            const { textToSpeech } = await import('../ai/flows/text-to-speech');
            const ttsResult = await textToSpeech({ text: aiGreeting });
            if (ttsResult.audioDataUri) {
                const useTTSPlayer = process.env.USE_TTS_PLAYER !== 'false';
                if (useTTSPlayer) {
                    await fetch('http://127.0.0.1:3100/api/tts/current', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ audioUrl: ttsResult.audioDataUri }),
                    }).catch(() => {});
                } else if ((global as any).broadcast) {
                    (global as any).broadcast({ type: 'play-tts', payload: { audioDataUri: ttsResult.audioDataUri } });
                }
            }
        } catch (error) {
            console.error('[Partner Checkin] TTS error:', error);
        }

        // 5. Send Discord notification
        const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
        if (webhookUrl) {
            await fetch(webhookUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content: `🎉 **${username}** just checked in under **${partner.name}**'s banner on stream!` }),
            }).catch(err => console.error('[Partner Checkin] Discord error:', err));
        }

        // 6. Broadcast to overlay via WebSocket
        if ((global as any).broadcast) {
            (global as any).broadcast({
                type: 'partner-checkin',
                payload: { username, square: squareNum, partner: { ...partner, imageUrl: partnerImageUrl } },
            });
        }

        console.log(`[Partner Checkin] COMPLETE: ${partner.name}`);
    } catch (error) {
        console.error('[Partner Checkin] FATAL ERROR:', error);
    }
}

export { handlePackOpen as handlePackOpenCmd };
async function handlePackOpen(username: string, setNumber: number, pointCost: number): Promise<void> {
    console.log(`[PokePack] ${username} opening set ${setNumber}`);
    try {
        const { openPack } = require('./pokemon-packs');
        const { getUserPoints, addPoints } = require('./points');

        if (pointCost > 0) {
            const points = await getUserPoints(username);
            if (points < pointCost) {
                sendChatMessage(`@${username}, you need ${pointCost} points to open a pack! (You have ${points})`, 'broadcaster').catch(() => {});
                return;
            }
            await addPoints(username, -pointCost, 'pokepack');
        }

        const result = await openPack(setNumber, username);

        if (result) {
            const cardNames = result.pack.map((c: any) => {
                const star = (c.rarity === 'Rare' || c.rarity === 'Rare Holo') ? '⭐' : '';
                return `${star}${c.name}`;
            }).join(', ');
            const { getUserPoints: getBalance } = require('./points');
            const newBalance = await getBalance(username);

            // 1. Broadcaster posts the card list + balance
            await sendChatMessage(`@${username} opened a ${result.setName} pack: ${cardNames} | Balance: ${newBalance} pts`, 'broadcaster');

            // 2. AI reaction to the pack
            const rares = result.pack.filter((c: any) => c.rarity === 'Rare' || c.rarity === 'Rare Holo');
            const botName = (global as any).botName || 'StreamWeaver';
            const botPersonality = (global as any).botPersonality || 'You are a friendly, energetic AI co-host for a live stream.';
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
                            text: `You are ${botName}. ${username} just opened a ${result.setName} Pokemon card pack on stream. ${rareList} Write a short, excited 1-2 sentence reaction to their pull. If they got a rare or holo, hype it up! Use space/cosmic imagery. Stay in character.`,
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

            // 3. Post as bot with TTS
            const { markTtsHandled } = require('./chat-dispatcher');
            markTtsHandled(aiReaction);
            await sendChatMessage(aiReaction, 'bot');

            try {
                const { textToSpeech } = await import('../ai/flows/text-to-speech');
                const ttsResult = await textToSpeech({ text: aiReaction });
                if (ttsResult.audioDataUri) {
                    const useTTSPlayer = process.env.USE_TTS_PLAYER !== 'false';
                    if (useTTSPlayer) {
                        await fetch('http://127.0.0.1:3100/api/tts/current', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ audioUrl: ttsResult.audioDataUri }),
                        }).catch(() => {});
                    } else if ((global as any).broadcast) {
                        (global as any).broadcast({ type: 'play-tts', payload: { audioDataUri: ttsResult.audioDataUri } });
                    }
                }
            } catch (err) {
                console.error('[PokePack] TTS error:', err);
            }
        } else {
            sendChatMessage(`@${username}, couldn't open that pack. Try a different set!`, 'broadcaster').catch(() => {});
        }
    } catch (error) {
        console.error('[PokePack] Error:', error);
    }
}
