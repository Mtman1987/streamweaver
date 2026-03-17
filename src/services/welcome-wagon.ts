import { readJsonFile, writeJsonFile } from './storage';
import { getTwitchUser } from './twitch';
import { getStoredTokens, ensureValidToken } from '../lib/token-utils.server';

const WELCOME_FILE = 'welcome-wagon.json';
const WELCOME_MODE_FILE = 'welcome-mode.json';
const GREETING_MODE_FILE = 'greeting-mode.json';

type WelcomeRecord = {
  streamStartTime: string;
  welcomedUsers: Set<string>;
};

type WelcomeMode = 'chat' | 'overlay';
type GreetingMode = 'chat' | 'overlay';

let currentSession: WelcomeRecord = {
  streamStartTime: new Date().toISOString(),
  welcomedUsers: new Set()
};

let welcomeMode: WelcomeMode = 'chat';
let greetingMode: GreetingMode = 'chat';

export async function loadWelcomeSession(): Promise<void> {
  try {
    const data = await readJsonFile<{ streamStartTime: string; welcomedUsers: string[] }>(WELCOME_FILE, {
      streamStartTime: new Date().toISOString(),
      welcomedUsers: []
    });
    
    currentSession = {
      streamStartTime: data.streamStartTime,
      welcomedUsers: new Set(data.welcomedUsers)
    };
    
    // Load welcome mode
    const modeData = await readJsonFile<{ mode: WelcomeMode }>(WELCOME_MODE_FILE, { mode: 'chat' });
    welcomeMode = modeData.mode;
    
    // Load greeting mode
    const greetingData = await readJsonFile<{ mode: GreetingMode }>(GREETING_MODE_FILE, { mode: 'chat' });
    greetingMode = greetingData.mode;
  } catch (error) {
    console.error('[Welcome] Failed to load session:', error);
  }
}

export async function toggleGreetingMode(): Promise<void> {
  greetingMode = greetingMode === 'chat' ? 'overlay' : 'chat';
  await writeJsonFile(GREETING_MODE_FILE, { mode: greetingMode });
}

export async function getGreetingMode(): Promise<GreetingMode> {
  return greetingMode;
}

export async function toggleWelcomeMode(): Promise<void> {
  welcomeMode = welcomeMode === 'chat' ? 'overlay' : 'chat';
  await writeJsonFile(WELCOME_MODE_FILE, { mode: welcomeMode });
}

export async function getWelcomeMode(): Promise<WelcomeMode> {
  return welcomeMode;
}

export async function saveWelcomeSession(): Promise<void> {
  try {
    await writeJsonFile(WELCOME_FILE, {
      streamStartTime: currentSession.streamStartTime,
      welcomedUsers: Array.from(currentSession.welcomedUsers)
    });
  } catch (error) {
    console.error('[Welcome] Failed to save session:', error);
  }
}

export async function resetWelcomeSession(): Promise<void> {
  currentSession = {
    streamStartTime: new Date().toISOString(),
    welcomedUsers: new Set()
  };
  await saveWelcomeSession();
}

export async function shouldWelcomeUser(username: string): Promise<boolean> {
  const key = username.toLowerCase();
  return !currentSession.welcomedUsers.has(key);
}

export async function markUserWelcomed(username: string): Promise<void> {
  const key = username.toLowerCase();
  currentSession.welcomedUsers.add(key);
  await saveWelcomeSession();
}

export async function fetchUserClip(username: string): Promise<{ embedUrl: string; duration: number } | null> {
  try {
    const clientId = process.env.TWITCH_CLIENT_ID;
    const clientSecret = process.env.TWITCH_CLIENT_SECRET;
    
    if (!clientId || !clientSecret) return null;
    
    const tokens = await getStoredTokens();
    if (!tokens) return null;
    
    const accessToken = await ensureValidToken(clientId, clientSecret, 'broadcaster', tokens);
    const user = await getTwitchUser(username, 'login');
    
    if (!user?.id) return null;
    
    const endDate = new Date().toISOString();
    const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 days ago
    
    const response = await fetch(
      `https://api.twitch.tv/helix/clips?broadcaster_id=${user.id}&started_at=${startDate}&ended_at=${endDate}&first=1`,
      {
        headers: {
          'Client-ID': clientId,
          'Authorization': `Bearer ${accessToken.replace('oauth:', '')}`,
        },
      }
    );
    
    if (!response.ok) return null;
    
    const data = await response.json();
    const clips = data.data;
    
    if (!clips || clips.length === 0) return null;
    
    const clip = clips[0];
    return {
      embedUrl: clip.embed_url,
      duration: Math.round(clip.duration)
    };
  } catch (error) {
    console.error('[Welcome] Failed to fetch clip:', error);
    return null;
  }
}

export async function generateWelcomeShoutout(username: string): Promise<{ message: string; twitchUrl: string; useAI?: boolean }> {
  try {
    const user = await getTwitchUser(username, 'login');
    const displayName = user?.displayName || username;
    const game = user?.lastGame || 'unknown adventures';
    
    const aiPrompt = `Generate a fun space-themed welcome message for new chatter ${displayName} who was playing ${game}. Make it cosmic and welcoming!`;
    const twitchUrl = `https://twitch.tv/${username.toLowerCase()}`;
    
    return { message: aiPrompt, twitchUrl, useAI: true };
  } catch (error) {
    console.error('[Welcome] Failed to generate shoutout:', error);
    return {
      message: `🚀 Welcome to the starship, ${username}! Ready for our cosmic adventure?`,
      twitchUrl: `https://twitch.tv/${username.toLowerCase()}`
    };
  }
}

export async function handleVsoCommand(username: string): Promise<{ success: boolean; message?: string; clipUrl?: string; clipDuration?: number; twitchUrl?: string; useAI?: boolean }> {
  try {
    const user = await getTwitchUser(username, 'login');
    if (!user) {
      return { success: false, message: `User ${username} not found` };
    }

    const displayName = user.displayName || username;
    const game = user.lastGame || 'unknown adventures';
    const clipData = await fetchUserClip(username);
    const twitchUrl = `https://twitch.tv/${username.toLowerCase()}`;
    
    return {
      success: true,
      message: `Generate a fun space-themed shoutout for ${displayName} who was playing ${game}. Make it cosmic and exciting!`,
      twitchUrl,
      useAI: true,
      ...(clipData && { clipUrl: clipData.embedUrl, clipDuration: clipData.duration })
    };
  } catch (error) {
    console.error('[VSO] Failed to handle VSO command:', error);
    return { success: false, message: 'Failed to process shoutout' };
  }
}