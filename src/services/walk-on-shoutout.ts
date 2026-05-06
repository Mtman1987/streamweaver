import { getTwitchUser } from './twitch';
import { sendChatMessage } from './twitch';
import { sendDiscordMessage } from './discord';
import { textToSpeech } from '../ai/flows/text-to-speech';
import { tenantPath } from '../lib/tenant';
import { canShoutoutUser, recordShoutout } from './welcome-wagon-tracker';
import { getAppConfig } from '../lib/app-config';
import { getBotName, getBotPersonality } from '../lib/bot-settings-store';
import { readUserConfigSync } from '../lib/user-config';
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

type ShoutoutMode = 'full' | 'overlay' | 'chat';

// ============================
// SHOUTOUT MODE RESOLUTION
// ============================

async function getShoutoutMode(tenantId?: string): Promise<ShoutoutMode> {
    // Legacy check
    const cfg = readUserConfigSync(tenantId);
    if (cfg.SKIP_SHOUTOUT_OVERLAY === 'true' || process.env.SKIP_SHOUTOUT_OVERLAY === 'true') {
        return 'chat';
    }
    try {
        const { getMode } = await import('./modes-manager');
        const mode = await getMode('greetingmode', tenantId);
        if (mode === 'full' || mode === 'overlay' || mode === 'chat') return mode;
        // Migrate legacy values
        if (mode === 'on') return 'full';
        if (mode === 'off') return 'chat';
    } catch {}
    return 'full';
}

// ============================
// BROADCASTER WELCOME MESSAGE
// ============================

async function sendBroadcasterWelcome(displayName: string, tenantId?: string): Promise<void> {
    const cfg = await getAppConfig();
    const template = cfg.shoutoutIntroMessage || 'Shoutout: go check out @{displayName} at https://twitch.tv/{displayName}';
    const msg = template
      .replaceAll('{displayName}', displayName)
      .replaceAll('{username}', displayName.toLowerCase())
      .replaceAll('{url}', `https://twitch.tv/${displayName}`);
    await sendChatMessage(msg, 'broadcaster', undefined, tenantId);
}

// ============================
// CLIP FETCHING
// ============================

async function fetchClip(username: string): Promise<TwitchClip | null> {
    try {
        const clientId = process.env.TWITCH_CLIENT_ID;
        const user = await getTwitchUser(username, 'login');

        if (!user?.id) {
            console.log(`[WalkOn] User ${username} not found`);
            return null;
        }

        const tokenResponse = await fetch(
            `https://id.twitch.tv/oauth2/token?client_id=${clientId}&client_secret=${process.env.TWITCH_CLIENT_SECRET}&grant_type=client_credentials`,
            { method: 'POST' }
        );
        const { access_token } = await tokenResponse.json();

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
    const playerUrl = `${process.env.NEXT_PUBLIC_STREAMWEAVE_URL || process.env.NEXT_PUBLIC_BASE_URL || `http://127.0.0.1:${process.env.PORT||3100}`}/shoutout-player?user=${encodeURIComponent(displayName)}&image=${encodeURIComponent(profileImage)}&video=${encodeURIComponent(embedURL)}&thumbnail_url=${encodeURIComponent(clip.thumbnailUrl)}`;

    const cfg = await getAppConfig();
    const sceneName = cfg.shoutoutScene || process.env.SHOUTOUT_SCENE || 'Shoutout';
    const sourceName = cfg.shoutoutBrowserSource || process.env.SHOUTOUT_BROWSER_SOURCE || 'Shoutout-Player';

    console.log(`[WalkOn] Scene: "${sceneName}", Source: "${sourceName}"`);
    console.log('[WalkOn] Opening shoutout player:', playerUrl);

    // Broadcast clip to overlay via WebSocket
    if (typeof (global as any).broadcast === 'function') {
        (global as any).broadcast({
            type: 'shoutout-play-clip',
            payload: { clipUrl: embedURL, thumbnailUrl: clip.thumbnailUrl, user: displayName, profileImage }
        }, tenantId);
    }

    // Also try OBS WebSocket
    const { setBrowserSource } = await import('./obs');

    try {
        await setBrowserSource(sceneName, sourceName, 'about:blank');
        await new Promise(r => setTimeout(r, 50));
        await setBrowserSource(sceneName, sourceName, playerUrl);
        console.log(`[WalkOn] Updated browser source successfully`);
    } catch (error) {
        console.error('[WalkOn] Failed to update browser source (OBS not connected?):', error);
    }

    await new Promise(resolve => setTimeout(resolve, delay + 2000));
}

// ============================
// PERSONALIZATION BUILDER
// ============================

async function buildPersona(username: string, displayName: string, profileImage: string, tenantId?: string): Promise<Persona> {
    const user = await getTwitchUser(username, 'login');

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

    let shoutoutCount = 0;
    try {
        const wwPath = tenantId
            ? tenantPath(tenantId, 'tokens/welcome-wagon.json')
            : resolve(process.cwd(), 'tokens', 'welcome-wagon.json');
        const welcomeData = JSON.parse(await fs.readFile(wwPath, 'utf-8'));
        shoutoutCount = welcomeData.shoutouts[username.toLowerCase()] ? 1 : 0;
    } catch {}

    let pointsData = null;
    try {
        const { getPoints } = require('./points');
        const points = await getPoints(username);
        pointsData = { points: points.points, rank: points.rank };
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

Stay fully in character as ${botName} and greet @${p.displayName} (${welcomeType}).

${selectedData.length > 0 ? `Weave this info naturally into the greeting: ${selectedData.join(', ')}` : ''}

Rules:
- 2-3 sentences max
- ${isFirstTime ? 'Say "welcome" not "welcome back"' : 'Acknowledge they\'ve been here before'}
- Write the greeting in YOUR voice and style, not generic`;
}

// ============================
// GREETING OUTPUT
// ============================

async function fireGreeting(aiGreeting: string, mode: ShoutoutMode, tenantId?: string): Promise<void> {
    const botName = getBotName(tenantId);

    // Chat message: full and chat modes type in chat
    if (mode === 'full' || mode === 'chat') {
        const { markTtsHandled } = require('./chat-dispatcher');
        markTtsHandled(aiGreeting);
        await sendChatMessage(aiGreeting, 'bot', undefined, tenantId);
    }

    // Overlay broadcast: overlay mode shows on overlay instead of chat
    if (mode === 'overlay') {
        if (typeof (global as any).broadcast === 'function') {
            (global as any).broadcast({
                type: 'greeting-overlay',
                payload: { text: aiGreeting, botName }
            }, tenantId);
        }
    }

    // TTS: full and overlay modes speak it
    if (mode === 'full' || mode === 'overlay') {
        try {
            const ttsResult = await textToSpeech({ text: aiGreeting, tenantId });
            if (ttsResult.audioDataUri) {
                const useTTSPlayer = process.env.USE_TTS_PLAYER !== 'false';
                if (useTTSPlayer) {
                    const tenantQuery = tenantId ? `?tenant=${encodeURIComponent(tenantId)}` : '';
                    await fetch(`http://127.0.0.1:${process.env.PORT||3100}/api/tts/current${tenantQuery}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ audioUrl: ttsResult.audioDataUri })
                    }).catch(err => console.error('[WalkOn] Failed to update TTS player:', err));
                } else {
                    if (typeof (global as any).broadcast === 'function') {
                        (global as any).broadcast({
                            type: 'play-tts',
                            payload: { audioDataUri: ttsResult.audioDataUri }
                        }, tenantId);
                    }
                }
            }
        } catch (error) {
            console.error('[WalkOn] TTS failed:', error);
        }
    }

    // Discord
    try {
        const discordChannelId = await getDiscordShoutoutChannelId(tenantId);
        if (discordChannelId) {
            await sendDiscordMessage(discordChannelId, `**${botName}:** ${aiGreeting}`);
        }
    } catch (error) {
        console.error('[WalkOn] Discord send failed:', error);
    }
}

async function getDiscordShoutoutChannelId(tenantId?: string): Promise<string | null> {
    try {
        const p = tenantId
            ? tenantPath(tenantId, 'tokens/discord-channels.json')
            : resolve(process.cwd(), 'tokens', 'discord-channels.json');
        const data = await fs.readFile(p, 'utf-8');
        const channels = JSON.parse(data);
        return channels.shoutoutChannelId || channels.logChannelId || null;
    } catch {
        return null;
    }
}

// ============================
// MAIN EXECUTION
// ============================

export async function handleWalkOnShoutout(username: string, displayName: string, profileImage: string, skipCooldown: boolean = false, tenantId?: string): Promise<void> {
    const user = username.toLowerCase();

    if (!skipCooldown && !(await canShoutoutUser(user, tenantId))) {
        console.log(`[WalkOn] Skipping shoutout for ${user} — on cooldown or excluded.`);
        return;
    }

    console.log(`[WalkOn] Processing walk-on shoutout for ${displayName}`);

    const mode = await getShoutoutMode(tenantId);
    console.log(`[WalkOn] Shoutout mode: ${mode}`);

    // Build persona and generate AI greeting
    const persona = await buildPersona(user, displayName, profileImage, tenantId);
    console.log(`[WalkOn] Generating AI greeting for ${displayName}...`);
    const aiGreeting = await generateAIGreeting(persona, tenantId);
    console.log(`[WalkOn] AI greeting generated`);

    // === MODE: CHAT ===
    // Single clean message: AI greeting + link. No clip, no TTS, no overlay.
    if (mode === 'chat') {
        const msg = `${aiGreeting} | Go check out @${displayName}: https://twitch.tv/${displayName}`;
        await sendChatMessage(msg, 'bot', undefined, tenantId);
        if (!skipCooldown) await recordShoutout(user, tenantId);
        console.log(`[WalkOn] Completed chat-only shoutout for ${displayName}`);
        return;
    }

    // === MODE: FULL or OVERLAY ===
    // Both play the clip first, then fire the greeting differently

    // Broadcaster drops the link
    await sendBroadcasterWelcome(displayName, tenantId);

    // Fetch and play clip
    const clip = await fetchClip(username);
    if (clip) {
        console.log(`[WalkOn] Playing clip for ${displayName}`);
        await playClip(clip, displayName, profileImage, tenantId);
        console.log(`[WalkOn] Clip finished for ${displayName}`);
    } else {
        console.log(`[WalkOn] No clips found for ${displayName}, skipping video`);
    }

    // Fire greeting (full = chat + TTS, overlay = overlay + TTS)
    await fireGreeting(aiGreeting, mode, tenantId);

    if (!skipCooldown) await recordShoutout(user, tenantId);
    console.log(`[WalkOn] Completed ${mode} shoutout for ${displayName}`);
}
