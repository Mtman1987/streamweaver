import { getTwitchUser } from './twitch';
import { sendChatMessage } from './twitch';
import { sendDiscordMessage } from './discord';
import { textToSpeech } from '../ai/flows/text-to-speech';
import { tenantPath } from '../lib/tenant';
import { readDiscordConfig } from '../lib/discord-config';
import { getShoutoutEligibility, getShoutoutCount, recordShoutout } from './welcome-wagon-tracker';
import { auditError, recordShoutoutAudit } from './shoutout-audit';
import { getAppConfig } from '../lib/app-config';
import { getBotName, getBotPersonality } from '../lib/bot-settings-store';
import { readUserConfigSync } from '../lib/user-config';
import { resolveSayStreamKey, SAY_SHOUTOUT_SUPPRESSION_MS, suppressSayForTenant } from './say-tts';
import { internalServiceHeaders } from '../lib/internal-service-auth';
import { isKnownBot } from './known-bots';
import { resolveShoutoutMode, type ShoutoutMode } from './shoutout-mode';
import * as fs from 'fs/promises';
import { resolve } from 'path';

interface Persona {
    user: string;
    displayName: string;
    profileImage: string;
    twitchUrl: string;
    bio: string;
    role: string | null;
    memory: string | null;
    followDate: Date | null;
    shoutoutCount: number;
    pointsData: { points: number; rank: string } | null;
    lastGame: string | null;
}

interface TwitchClip {
    url: string;
    thumbnailUrl: string;
    duration: number;
    broadcasterName: string;
}

type ShoutoutOptions = {
    chatReply?: (message: string) => Promise<void>;
    linkMessage?: string;
    source?: 'auto-welcome' | 'manual' | 'voice' | 'recovery' | 'unknown';
};

type AuditContext = {
    username: string;
    displayName: string;
    source: NonNullable<ShoutoutOptions['source']>;
};

function normalizeTenantId(tenantId?: string): string | undefined {
    if (tenantId?.startsWith('__kick_silent__:')) return tenantId.slice('__kick_silent__:'.length);
    return tenantId;
}

async function getTenantStorageUsername(tenantId?: string): Promise<string> {
    if (!tenantId) {
        const cfg = readUserConfigSync();
        return cfg.TWITCH_BROADCASTER_USERNAME || 'default';
    }
    try {
        const raw = await fs.readFile(tenantPath(tenantId, 'tokens/twitch-tokens.json'), 'utf-8');
        const tokens = JSON.parse(raw);
        return tokens.broadcasterUsername || tokens.loginUsername || 'default';
    } catch {
        const cfg = readUserConfigSync(tenantId);
        return cfg.TWITCH_BROADCASTER_USERNAME || 'default';
    }
}

async function suppressSayDuringShoutout(tenantId?: string): Promise<void> {
    const keys = new Set<string>();
    if (tenantId) keys.add(tenantId);

    try {
        const storageUsername = await getTenantStorageUsername(tenantId);
        if (storageUsername && storageUsername !== 'default') {
            keys.add(resolveSayStreamKey(undefined, 'twitch', storageUsername));
        }
    } catch {
        // Tenant id suppression still protects the normal live path.
    }

    for (const key of keys) {
        suppressSayForTenant(key, SAY_SHOUTOUT_SUPPRESSION_MS, 'shoutout');
    }
}

// ============================
// SHOUTOUT MODE RESOLUTION
// ============================

async function getShoutoutMode(tenantId?: string): Promise<ShoutoutMode> {
    tenantId = normalizeTenantId(tenantId);
    let persistedMode: string | undefined;
    try {
        const { getMode } = await import('./modes-manager');
        persistedMode = await getMode('greetingmode', tenantId);
    } catch {}
    const cfg = readUserConfigSync(tenantId);
    return resolveShoutoutMode({
        persistedMode,
        legacySkipOverlay:
            cfg.SKIP_SHOUTOUT_OVERLAY === 'true'
            || process.env.SKIP_SHOUTOUT_OVERLAY === 'true',
    });
}

// ============================
// BROADCASTER WELCOME MESSAGE
// ============================

async function sendBroadcasterWelcome(displayName: string, tenantId?: string, options: ShoutoutOptions = {}): Promise<void> {
    const cfg = await getAppConfig();
    const template = cfg.shoutoutIntroMessage || 'Shoutout: go check out @{displayName} at https://twitch.tv/{displayName}';
    const msg = options.linkMessage || template
      .replaceAll('{displayName}', displayName)
      .replaceAll('{username}', displayName.toLowerCase())
      .replaceAll('{url}', `https://twitch.tv/${displayName}`);
    if (options.chatReply) {
        await options.chatReply(msg);
        return;
    }
    await sendChatMessage(msg, 'broadcaster', undefined, tenantId);
}

// ============================
// CLIP FETCHING
// ============================

export async function fetchClip(username: string): Promise<TwitchClip | null> {
    try {
        const clientId = process.env.TWITCH_CLIENT_ID;
        const clientSecret = process.env.TWITCH_CLIENT_SECRET;
        if (!clientId || !clientSecret) {
            console.warn('[WalkOn] Twitch client credentials missing; skipping clip fetch');
            return null;
        }
        const user = await getTwitchUser(username, 'login');

        if (!user?.id) {
            console.log(`[WalkOn] User ${username} not found`);
            return null;
        }

        const tokenResponse = await fetch(
            `https://id.twitch.tv/oauth2/token?client_id=${clientId}&client_secret=${clientSecret}&grant_type=client_credentials`,
            { method: 'POST' }
        );
        if (!tokenResponse.ok) {
            console.warn(`[WalkOn] Twitch app token request failed: ${tokenResponse.status} ${tokenResponse.statusText}`);
            return null;
        }
        const { access_token } = await tokenResponse.json();
        if (!access_token) return null;

        const endDate = new Date();
        const startDate = new Date();
        startDate.setFullYear(startDate.getFullYear() - 2);

        const response = await fetch(
            `https://api.twitch.tv/helix/clips?broadcaster_id=${user.id}&started_at=${startDate.toISOString()}&ended_at=${endDate.toISOString()}&first=100`,
            {
                headers: {
                    'Authorization': `Bearer ${access_token}`,
                    'Client-ID': clientId!
                }
            }
        );

        const data = await response.json();
        console.log(`[WalkOn] Found ${data.data?.length || 0} clips for ${username}`);

        if (!data.data || data.data.length === 0) return null;

        const clip = data.data[Math.floor(Math.random() * data.data.length)];
        console.log(`[WalkOn] Selected clip: ${clip.url}`);

        return {
            url: clip.url,
            thumbnailUrl: clip.thumbnail_url,
            duration: clip.duration,
            broadcasterName: clip.broadcaster_name
        };
    } catch (error) {
        console.error('[WalkOn] Clip fetch failed:', error);
        return null;
    }
}

// ============================
// CLIP PLAYBACK (NON-BLOCKING)
// ============================

async function playClip(clip: TwitchClip, displayName: string, profileImage: string, tenantId?: string): Promise<void> {
    const embedURL = clip.url.replace('twitch.tv/', 'twitch.tv/embed?clip=');
    const delay = 700 + Math.floor(clip.duration * 1000);
    const broadcastTenantId = normalizeTenantId(tenantId);

    console.log(`[WalkOn] Broadcasting clip to shoutout overlay for ${displayName}`);

    // Broadcast clip to shoutout overlay via WebSocket
    if (typeof (global as any).broadcast === 'function') {
        (global as any).broadcast({
            type: 'shoutout-play-clip',
            payload: { clipUrl: embedURL, thumbnailUrl: clip.thumbnailUrl, user: displayName, profileImage }
        }, broadcastTenantId);
    }

    // Wait for clip to finish playing
    await new Promise(resolve => setTimeout(resolve, delay + 2000));
}

// ============================
// PERSONALIZATION BUILDER
// ============================

async function buildPersona(username: string, displayName: string, profileImage: string, tenantId?: string): Promise<Persona> {
    let user: Awaited<ReturnType<typeof getTwitchUser>> = null;
    try {
        user = await getTwitchUser(username, 'login');
    } catch (error) {
        console.warn(`[WalkOn] Twitch profile lookup failed for ${username}; using fallback persona`, error);
    }

    let memory = null;
    try {
        const memoryPath = tenantId
            ? tenantPath(tenantId, 'tokens/chat-memory.json')
            : resolve(process.cwd(), 'tokens', 'chat-memory.json');
        const memoryData = await fs.readFile(memoryPath, 'utf-8');
        const chatMemory = JSON.parse(memoryData);
        const userMemory = chatMemory[username.toLowerCase()];
        if (userMemory && userMemory.length > 0) {
            memory = userMemory.slice(-3).map((m: any) => `${m.role}: ${m.content}`).join(' | ');
        }
    } catch {}

    const shoutoutCount = await getShoutoutCount(username, tenantId).catch(() => 0);

    let pointsData = null;
    try {
        const { getPoints } = require('./points');
        const storageUsername = await getTenantStorageUsername(tenantId);
        const points = await getPoints(username, tenantId ? { tenantId, username: storageUsername } : undefined);
        pointsData = { points: points.points, rank: `level ${points.level}` };
    } catch {}

    return {
        user: username,
        displayName,
        profileImage,
        twitchUrl: `https://twitch.tv/${displayName}`,
        bio: user?.bio || '',
        role: null,
        memory,
        followDate: null,
        shoutoutCount,
        pointsData,
        lastGame: user?.lastGame ?? null
    };
}

// ============================
// AI GREETING GENERATION
// ============================

async function generateAIGreeting(persona: Persona, tenantId?: string): Promise<string> {
    const botName = getBotName(tenantId);
    const fallbackGreeting = `Welcome, @${persona.displayName}! Glad you're here!`;
    const prompt = buildPrompt(persona, tenantId);

    const edenaiKey = process.env.EDENAI_API_KEY;
    if (edenaiKey) {
        try {
            const botPersonality = getBotPersonality(tenantId);

            const response = await fetch('https://api.edenai.run/v2/text/chat', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${edenaiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    providers: 'openai',
                    text: prompt,
                    chatbot_global_action: botPersonality,
                    temperature: 0.8,
                    max_tokens: 180
                })
            });

            if (response.ok) {
                const data = await response.json();
                const text = data.openai?.generated_text?.trim();
                if (text) return text;
            }
        } catch (error) {
            console.error('[WalkOn] EdenAI failed:', error);
        }
    }

    return fallbackGreeting;
}

function buildPrompt(p: Persona, tenantId?: string): string {
    const botName = getBotName(tenantId);
    const botPersonality = getBotPersonality(tenantId);

    const personalData = [];
    if (p.bio) personalData.push(`bio: "${p.bio}"`);
    if (p.memory) personalData.push(`recent chat: "${p.memory}"`);
    if (p.lastGame) personalData.push(`last played: ${p.lastGame}`);
    if (p.pointsData) personalData.push(`${p.pointsData.points} points (${p.pointsData.rank})`);

    const selectedData = personalData.length > 3
        ? personalData.sort(() => 0.5 - Math.random()).slice(0, 3)
        : personalData;

    const isFirstTime = p.shoutoutCount === 0;
    const welcomeType = isFirstTime ? 'first-time visitor' : 'returning friend';

    return `You are ${botName}. Your personality and speaking style:
${botPersonality}

Write a fresh walk-on greeting for @${p.displayName}, who is a ${welcomeType}.

${selectedData.length > 0 ? `Weave this info naturally into the greeting: ${selectedData.join(', ')}` : ''}

Rules:
- 2-3 sentences max
- ${isFirstTime ? 'Say "welcome" not "welcome back"' : 'Acknowledge they\'ve been here before'}
- Sound like ${botName}, not a generic assistant
- Do not say "my designation", "it is an honor", "thrilled", or "whenever you're ready"
- Do not mention being here to explore unless that is part of the configured personality
- Do not repeat the same sentence structure as prior greetings
- Address the viewer directly`;
}

// ============================
// GREETING OUTPUT
// ============================

async function fireGreeting(aiGreeting: string, mode: ShoutoutMode, tenantId?: string, options: ShoutoutOptions = {}, audit?: AuditContext): Promise<void> {
    const realTenantId = normalizeTenantId(tenantId);
    const botName = getBotName(realTenantId);

    // Chat message: full and chat modes type in chat
    if (mode === 'full' || mode === 'chat') {
        const { markTtsHandled } = require('./chat-dispatcher');
        markTtsHandled(aiGreeting);
        if (options.chatReply) await options.chatReply(aiGreeting);
        else await sendChatMessage(aiGreeting, 'bot', undefined, tenantId);
        if (audit) {
            await recordShoutoutAudit({
                status: 'phase',
                phase: 'chat-message-sent',
                username: audit.username,
                displayName: audit.displayName,
                tenantId: realTenantId,
                source: audit.source,
                mode,
            });
        }
    }

    // Overlay broadcast: overlay mode shows on overlay instead of chat
    if (mode === 'overlay') {
        if (typeof (global as any).broadcast === 'function') {
            (global as any).broadcast({
                type: 'greeting-overlay',
                payload: { text: aiGreeting, botName }
            }, realTenantId);
            if (audit) {
                await recordShoutoutAudit({
                    status: 'phase',
                    phase: 'overlay-broadcast',
                    username: audit.username,
                    displayName: audit.displayName,
                    tenantId: realTenantId,
                    source: audit.source,
                    mode,
                });
            }
        }
    }

    // TTS: full and overlay modes speak it
    if (mode === 'full' || mode === 'overlay') {
        try {
            const ttsResult = await textToSpeech({ text: aiGreeting, tenantId: realTenantId });
            if (ttsResult.audioDataUri) {
                const useTTSPlayer = process.env.USE_TTS_PLAYER !== 'false';
                if (useTTSPlayer) {
                    const tenantQuery = realTenantId ? `?tenant=${encodeURIComponent(realTenantId)}` : '';
                    await fetch(`http://127.0.0.1:${process.env.PORT||3100}/api/tts/current${tenantQuery}`, {
                        method: 'POST',
                        headers: internalServiceHeaders({ 'Content-Type': 'application/json' }),
                        body: JSON.stringify({ audioUrl: ttsResult.audioDataUri })
                    }).catch(err => console.error('[WalkOn] Failed to update TTS player:', err));
                } else {
                    if (typeof (global as any).broadcast === 'function') {
                        (global as any).broadcast({
                            type: 'play-tts',
                            payload: { audioDataUri: ttsResult.audioDataUri }
                        }, realTenantId);
                    }
                }
                if (typeof (global as any).broadcast === 'function') {
                    try {
                        const { showTalkingAvatar, hideAvatarAfterDelay } = require('../server/avatar');
                        showTalkingAvatar((global as any).broadcast, realTenantId);
                        hideAvatarAfterDelay(12000, (global as any).broadcast, realTenantId);
                    } catch (avatarErr) {
                        console.error('[WalkOn] Avatar trigger failed:', avatarErr);
                    }
                }
                if (audit) {
                    await recordShoutoutAudit({
                        status: 'phase',
                        phase: 'tts-ready',
                        username: audit.username,
                        displayName: audit.displayName,
                        tenantId: realTenantId,
                        source: audit.source,
                        mode,
                    });
                }
            }
        } catch (error) {
            console.error('[WalkOn] TTS failed:', error);
            if (audit) {
                await recordShoutoutAudit({
                    status: 'phase',
                    phase: 'tts-failed',
                    username: audit.username,
                    displayName: audit.displayName,
                    tenantId: realTenantId,
                    source: audit.source,
                    mode,
                    error: auditError(error),
                });
            }
        }
    }

    // Discord
    try {
        const discordChannelId = await getDiscordShoutoutChannelId(realTenantId);
        if (discordChannelId) {
            await sendDiscordMessage(discordChannelId, `**${botName}:** ${aiGreeting}`);
            if (audit) {
                await recordShoutoutAudit({
                    status: 'phase',
                    phase: 'discord-message-sent',
                    username: audit.username,
                    displayName: audit.displayName,
                    tenantId: realTenantId,
                    source: audit.source,
                    mode,
                    metadata: { discordChannelId },
                });
            }
        }
    } catch (error) {
        console.error('[WalkOn] Discord send failed:', error);
        if (audit) {
            await recordShoutoutAudit({
                status: 'phase',
                phase: 'discord-send-failed',
                username: audit.username,
                displayName: audit.displayName,
                tenantId: realTenantId,
                source: audit.source,
                mode,
                error: auditError(error),
            });
        }
    }
}

async function getDiscordShoutoutChannelId(tenantId?: string): Promise<string | null> {
    if (!tenantId) return null;
    try {
        const channels = await readDiscordConfig(tenantId);
        if (channels.discordBridgeEnabled === false) return null;
        return channels.shoutoutChannelId || null;
    } catch {
        return null;
    }
}

// ============================
// MAIN EXECUTION
// ============================

export async function handleWalkOnShoutout(username: string, displayName: string, profileImage: string, skipCooldown: boolean = false, tenantId?: string, options: ShoutoutOptions = {}): Promise<boolean> {
    const user = username.toLowerCase();
    const realTenantId = normalizeTenantId(tenantId);
    const auditSource = options.source || (skipCooldown ? 'manual' : 'auto-welcome');

    if (await isKnownBot(user, realTenantId)) {
        console.log(`[WalkOn] Skipping shoutout for ${user} — known/ignored bot.`);
        await recordShoutoutAudit({
            status: 'skipped',
            username: user,
            displayName,
            tenantId: realTenantId,
            source: auditSource,
            reason: 'known-bot',
            metadata: { skipCooldown },
        });
        return false;
    }

    const shoutoutEligibility = skipCooldown ? { eligible: true as const } : await getShoutoutEligibility(user, realTenantId);
    if (!shoutoutEligibility.eligible) {
        const remainingMinutes = shoutoutEligibility.remainingMs
            ? Math.ceil(shoutoutEligibility.remainingMs / 60_000)
            : undefined;
        console.log(`[WalkOn] Skipping shoutout for ${user} — ${shoutoutEligibility.reason}.`);
        await recordShoutoutAudit({
            status: 'skipped',
            username: user,
            displayName,
            tenantId: realTenantId,
            source: auditSource,
            reason: shoutoutEligibility.reason,
            metadata: remainingMinutes ? { remainingMinutes } : undefined,
        });
        return false;
    }

    console.log(`[WalkOn] Processing walk-on shoutout for ${displayName}`);
    await recordShoutoutAudit({
        status: 'started',
        username: user,
        displayName,
        tenantId: realTenantId,
        source: auditSource,
        metadata: { skipCooldown },
    });

    const mode = await getShoutoutMode(realTenantId);
    console.log(`[WalkOn] Shoutout mode: ${mode}`);
    if (mode === 'full' || mode === 'overlay') {
        await suppressSayDuringShoutout(realTenantId);
    }
    await recordShoutoutAudit({
        status: 'phase',
        phase: 'mode-resolved',
        username: user,
        displayName,
        tenantId: realTenantId,
        source: auditSource,
        mode,
    });

    // Build persona and generate AI greeting
    const persona = await buildPersona(user, displayName, profileImage, realTenantId);
    console.log(`[WalkOn] Generating AI greeting for ${displayName}...`);
    const aiGreeting = await generateAIGreeting(persona, realTenantId);
    console.log(`[WalkOn] AI greeting generated`);
    await recordShoutoutAudit({
        status: 'phase',
        phase: 'ai-greeting-generated',
        username: user,
        displayName,
        tenantId: realTenantId,
        source: auditSource,
        mode,
    });

    // === MODE: CHAT ===
    // Single clean message: AI greeting + link. No clip, no TTS, no overlay.
    if (mode === 'chat') {
        const msg = options.linkMessage || `${aiGreeting} | Go check out @${displayName}: https://twitch.tv/${displayName}`;
        const fullMsg = options.linkMessage ? `${aiGreeting} | ${msg}` : msg;
        if (options.chatReply) await options.chatReply(fullMsg);
        else await sendChatMessage(fullMsg, 'bot', undefined, tenantId);
        if (!skipCooldown) await recordShoutout(user, realTenantId);
        console.log(`[WalkOn] Completed chat-only shoutout for ${displayName}`);
        await recordShoutoutAudit({
            status: 'completed',
            username: user,
            displayName,
            tenantId: realTenantId,
            source: auditSource,
            mode,
            phase: 'chat-only',
        });
        return true;
    }

    // === MODE: FULL or OVERLAY ===
    // Both play the clip first, then fire the greeting after

    // Broadcaster drops the link. If that identity is unavailable, keep the
    // shoutout moving so the bot greeting can still fire.
    try {
        await sendBroadcasterWelcome(displayName, tenantId, options);
        await recordShoutoutAudit({
            status: 'phase',
            phase: 'broadcaster-link-sent',
            username: user,
            displayName,
            tenantId: realTenantId,
            source: auditSource,
            mode,
        });
    } catch (error) {
        console.error(`[WalkOn] Broadcaster welcome send failed for ${displayName}:`, error);
        await recordShoutoutAudit({
            status: 'phase',
            phase: 'broadcaster-link-failed',
            username: user,
            displayName,
            tenantId: realTenantId,
            source: auditSource,
            mode,
            error: auditError(error),
        });
    }

    // Fetch and play clip (errors won't prevent greeting from firing)
    try {
        const clip = await fetchClip(username);
        if (clip) {
            console.log(`[WalkOn] Playing clip for ${displayName}`);
            await playClip(clip, displayName, profileImage, realTenantId);
            console.log(`[WalkOn] Clip finished for ${displayName}`);
            await recordShoutoutAudit({
                status: 'phase',
                phase: 'clip-played',
                username: user,
                displayName,
                tenantId: realTenantId,
                source: auditSource,
                mode,
            });
        } else {
            console.log(`[WalkOn] No clips found for ${displayName}, skipping video`);
            await recordShoutoutAudit({
                status: 'phase',
                phase: 'clip-not-found',
                username: user,
                displayName,
                tenantId: realTenantId,
                source: auditSource,
                mode,
            });
        }
    } catch (err) {
        console.error(`[WalkOn] Clip playback failed for ${displayName}:`, err);
        await recordShoutoutAudit({
            status: 'phase',
            phase: 'clip-failed',
            username: user,
            displayName,
            tenantId: realTenantId,
            source: auditSource,
            mode,
            error: auditError(err),
        });
    }

    // Fire greeting after clip (full = chat + TTS, overlay = overlay + TTS)
    await suppressSayDuringShoutout(realTenantId);
    await fireGreeting(aiGreeting, mode, tenantId, options, { username: user, displayName, source: auditSource });

    if (!skipCooldown) await recordShoutout(user, realTenantId);
    console.log(`[WalkOn] Completed ${mode} shoutout for ${displayName}`);
    await recordShoutoutAudit({
        status: 'completed',
        username: user,
        displayName,
        tenantId: realTenantId,
        source: auditSource,
        mode,
    });
    return true;
}
