import { readJsonFile, writeJsonFile, StorageContext } from './storage';
import { getTwitchUser } from './twitch';
import { getStoredTokens, ensureValidToken } from '../lib/token-utils.server';
import { isKnownBot } from './known-bots';

const WELCOME_FILE = 'welcome-wagon.json';
const WELCOME_MODE_FILE = 'welcome-mode.json';
const GREETING_MODE_FILE = 'greeting-mode.json';

type WelcomeRecord = {
  streamStartTime: string;
  welcomeDay: string;
  welcomedUsers: Set<string>;
};

type WelcomeMode = 'chat' | 'overlay' | 'off';
type GreetingMode = 'full' | 'chat' | 'overlay';
type WelcomeEligibility =
  | { eligible: true }
  | { eligible: false; reason: 'already-welcomed-today' | 'known-bot' };

// Per-tenant state
const tenantSessions = new Map<string, WelcomeRecord>();
const tenantWelcomeMode = new Map<string, WelcomeMode>();
const tenantGreetingMode = new Map<string, GreetingMode>();

function tKey(tenantId?: string): string { return tenantId || '__global__'; }

function getWelcomeDay(date = new Date()): string {
  const timeZone = process.env.WELCOME_WAGON_TIME_ZONE || process.env.TZ || 'America/Winnipeg';
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

function getSession(tenantId?: string): WelcomeRecord {
  const key = tKey(tenantId);
  if (!tenantSessions.has(key)) {
    tenantSessions.set(key, { streamStartTime: new Date().toISOString(), welcomeDay: getWelcomeDay(), welcomedUsers: new Set() });
  }
  const session = tenantSessions.get(key)!;
  const today = getWelcomeDay();
  if (session.welcomeDay !== today) {
    session.streamStartTime = new Date().toISOString();
    session.welcomeDay = today;
    session.welcomedUsers.clear();
  }
  return session;
}

function toCtx(tenantId?: string): StorageContext | undefined {
  if (!tenantId) return undefined;
  return { tenantId, username: '' };
}

export async function loadWelcomeSession(tenantId?: string): Promise<void> {
  try {
    const ctx = toCtx(tenantId);
    const today = getWelcomeDay();
    const data = await readJsonFile<{ streamStartTime: string; welcomeDay?: string; welcomedUsers: string[] }>(WELCOME_FILE, {
      streamStartTime: new Date().toISOString(),
      welcomeDay: today,
      welcomedUsers: []
    }, ctx);
    const welcomeDay = data.welcomeDay || getWelcomeDay(new Date(data.streamStartTime || Date.now()));

    const key = tKey(tenantId);
    tenantSessions.set(key, {
      streamStartTime: welcomeDay === today ? data.streamStartTime : new Date().toISOString(),
      welcomeDay: today,
      welcomedUsers: welcomeDay === today ? new Set(data.welcomedUsers) : new Set()
    });

    const modeData = await readJsonFile<{ mode: WelcomeMode }>(WELCOME_MODE_FILE, { mode: 'chat' }, ctx);
    tenantWelcomeMode.set(key, modeData.mode);

    const greetingData = await readJsonFile<{ mode: GreetingMode }>(GREETING_MODE_FILE, { mode: 'chat' }, ctx);
    tenantGreetingMode.set(key, greetingData.mode);
  } catch (error) {
    console.error('[Welcome] Failed to load session:', error);
  }
}

export async function toggleGreetingMode(tenantId?: string): Promise<void> {
  const { toggleMode } = await import('./modes-manager');
  await toggleMode('greetingmode', tenantId);
}

export async function getGreetingMode(tenantId?: string): Promise<GreetingMode> {
  const { getMode } = await import('./modes-manager');
  return await getMode('greetingmode', tenantId) as GreetingMode;
}

export async function toggleWelcomeMode(tenantId?: string): Promise<void> {
  const { toggleMode } = await import('./modes-manager');
  await toggleMode('welcomemode', tenantId);
}

export async function getWelcomeMode(tenantId?: string): Promise<WelcomeMode> {
  const { getMode } = await import('./modes-manager');
  return await getMode('welcomemode', tenantId) as WelcomeMode;
}

export async function saveWelcomeSession(tenantId?: string): Promise<void> {
  try {
    const session = getSession(tenantId);
    await writeJsonFile(WELCOME_FILE, {
      streamStartTime: session.streamStartTime,
      welcomeDay: session.welcomeDay,
      welcomedUsers: Array.from(session.welcomedUsers)
    }, toCtx(tenantId));
  } catch (error) {
    console.error('[Welcome] Failed to save session:', error);
  }
}

export async function resetWelcomeSession(tenantId?: string): Promise<void> {
  tenantSessions.set(tKey(tenantId), {
    streamStartTime: new Date().toISOString(),
    welcomeDay: getWelcomeDay(),
    welcomedUsers: new Set()
  });
  await saveWelcomeSession(tenantId);
}

export async function getWelcomeEligibility(username: string, tenantId?: string): Promise<WelcomeEligibility> {
  const key = username.toLowerCase();
  const session = getSession(tenantId);

  if (session.welcomedUsers.has(key)) return { eligible: false, reason: 'already-welcomed-today' };

  // Skip known bots
  if (await isKnownBot(key, tenantId)) return { eligible: false, reason: 'known-bot' };

  return { eligible: true };
}

export async function shouldWelcomeUser(username: string, tenantId?: string): Promise<boolean> {
  return (await getWelcomeEligibility(username, tenantId)).eligible;
}

export async function markUserWelcomed(username: string, tenantId?: string): Promise<void> {
  const session = getSession(tenantId);
  session.welcomedUsers.add(username.toLowerCase());
  await saveWelcomeSession(tenantId);
}

export async function fetchUserClip(username: string, tenantId?: string): Promise<{ embedUrl: string; duration: number } | null> {
  try {
    const clientId = process.env.TWITCH_CLIENT_ID;
    const clientSecret = process.env.TWITCH_CLIENT_SECRET;
    if (!clientId || !clientSecret) return null;

    const tokens = await getStoredTokens(tenantId);
    if (!tokens) return null;

    const accessToken = await ensureValidToken(clientId, clientSecret, 'broadcaster', tokens, tenantId);
    const user = await getTwitchUser(username, 'login');
    if (!user?.id) return null;

    const endDate = new Date().toISOString();
    const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const response = await fetch(
      `https://api.twitch.tv/helix/clips?broadcaster_id=${user.id}&started_at=${startDate}&ended_at=${endDate}&first=50`,
      { headers: { 'Client-ID': clientId, 'Authorization': `Bearer ${accessToken.replace('oauth:', '')}` } }
    );
    if (!response.ok) return null;

    const data = await response.json();
    const clips = data.data;
    if (!clips || clips.length === 0) return null;

    const clip = clips[Math.floor(Math.random() * clips.length)];

    return { embedUrl: clip.embed_url, duration: Math.round(clip.duration) };
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
    const twitchUrl = `https://twitch.tv/${username.toLowerCase()}`;
    return { message: `Generate a fun space-themed welcome message for new chatter ${displayName} who was playing ${game}. Make it cosmic and welcoming!`, twitchUrl, useAI: true };
  } catch {
    return { message: `🚀 Welcome to the starship, ${username}! Ready for our cosmic adventure?`, twitchUrl: `https://twitch.tv/${username.toLowerCase()}` };
  }
}

export async function handleVsoCommand(username: string, tenantId?: string): Promise<{ success: boolean; message?: string; clipUrl?: string; clipDuration?: number; twitchUrl?: string; useAI?: boolean }> {
  try {
    const user = await getTwitchUser(username, 'login');
    if (!user) return { success: false, message: `User ${username} not found` };

    const displayName = user.displayName || username;
    const game = user.lastGame || 'unknown adventures';
    const clipData = await fetchUserClip(username, tenantId);
    const twitchUrl = `https://twitch.tv/${username.toLowerCase()}`;

    return {
      success: true,
      message: `Generate a fun space-themed shoutout for ${displayName} who was playing ${game}. Make it cosmic and exciting!`,
      twitchUrl,
      useAI: true,
      ...(clipData && { clipUrl: clipData.embedUrl, clipDuration: clipData.duration })
    };
  } catch {
    return { success: false, message: 'Failed to process shoutout' };
  }
}
