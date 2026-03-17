import { sendChatMessage } from './twitch';
import { setScene, getCurrentScene, setBrowserSource } from './obs';
import { readJsonFile, writeJsonFile } from './storage';
import { getStoredTokens, ensureValidToken } from '../lib/token-utils.server';
import { readUserConfig } from '../lib/user-config';
import { getAppConfig } from '../lib/app-config';
import { getTwitchUser } from './twitch';

let isPlaying = false;
let stopRequested = false;

const CLIP_MODE_FILE = 'brb-clip-mode.json';

async function getChattersDirectly(): Promise<{ user_id: string; user_login: string; user_display_name: string; }[]> {
  try {
    const userConfig = await readUserConfig();
    const clientId = process.env.TWITCH_CLIENT_ID;
    const clientSecret = process.env.TWITCH_CLIENT_SECRET;
    let broadcasterId = userConfig.NEXT_PUBLIC_HARDCODED_ADMIN_TWITCH_ID || process.env.NEXT_PUBLIC_HARDCODED_ADMIN_TWITCH_ID || userConfig.TWITCH_BROADCASTER_ID || process.env.TWITCH_BROADCASTER_ID;

    if (!broadcasterId) {
      const username = userConfig.TWITCH_BROADCASTER_USERNAME || process.env.TWITCH_BROADCASTER_USERNAME;
      if (username) {
        const twitchUser = await getTwitchUser(username, 'login');
        broadcasterId = twitchUser?.id;
      }
    }

    if (!clientId || !clientSecret || !broadcasterId) {
      console.warn('[BRB] Twitch configuration missing');
      return [];
    }

    const storedTokens = await getStoredTokens();
    if (!storedTokens) {
      console.warn('[BRB] No stored tokens found');
      return [];
    }

    const broadcasterToken = await ensureValidToken(clientId, clientSecret, 'broadcaster', storedTokens);
    if (!broadcasterToken) {
      console.warn('[BRB] Broadcaster token not found');
      return [];
    }

    const url = `https://api.twitch.tv/helix/chat/chatters?broadcaster_id=${broadcasterId}&moderator_id=${broadcasterId}`;
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${broadcasterToken.replace('oauth:', '')}`,
        'Client-ID': clientId,
      },
    });

    if (!response.ok) {
      console.warn(`[BRB] Chatters API error: ${response.status}`);
      return [];
    }

    const data = await response.json();
    console.log(`[BRB] Found ${data.data?.length || 0} chatters`);
    return data.data || [];
  } catch (error) {
    console.warn('[BRB] Error fetching chatters:', error);
    return [];
  }
}

async function getClipModeFromStorage(): Promise<boolean> {
  const data = await readJsonFile<{ useViewerClips: boolean }>(CLIP_MODE_FILE, { useViewerClips: false });
  return data.useViewerClips;
}

async function setClipModeToStorage(useViewerClips: boolean): Promise<void> {
  await writeJsonFile(CLIP_MODE_FILE, { useViewerClips });
}

export async function toggleClipMode(): Promise<void> {
  const current = await getClipModeFromStorage();
  const newMode = !current;
  await setClipModeToStorage(newMode);
  console.log(`[BRB] Clip mode: ${newMode ? 'VIEWER' : 'BROADCASTER'}`);
}

export async function getClipMode(): Promise<'broadcaster' | 'viewer'> {
  const useViewerClips = await getClipModeFromStorage();
  return useViewerClips ? 'viewer' : 'broadcaster';
}

export async function startBRB(broadcasterName: string): Promise<void> {
  if (isPlaying) {
    console.log('[BRB] Already playing clips');
    return;
  }
  
  isPlaying = true;
  stopRequested = false;
  
  const cfg = await getAppConfig();
  const scene = cfg.brbScene || process.env.BRB_SCENE || 'BRB';
  const source = cfg.brbBrowserSource || process.env.BRB_BROWSER_SOURCE || 'ClipPlayer';
  
  console.log(`[BRB] Using scene: "${scene}", source: "${source}"`);
  
  await setScene(scene);
  
  // Wait for scene switch
  for (let i = 0; i < 25; i++) {
    if (await getCurrentScene() === scene) break;
    await new Promise(r => setTimeout(r, 250));
  }
  
  while (!stopRequested && await getCurrentScene() === scene) {
    // Fetch fresh clip mode and chatters on each cycle
    const useViewerClips = await getClipModeFromStorage();
    console.log(`[BRB] Clip mode: ${useViewerClips ? 'VIEWER' : 'BROADCASTER'}`);
    
    let targetUsers: string[];
    if (useViewerClips) {
      const chatters = await getChattersDirectly();
      const viewerUsers = chatters.map(c => c.user_login).filter(u => u !== broadcasterName.toLowerCase());
      
      if (viewerUsers.length === 0) {
        console.log(`[BRB] No chatters found, falling back to broadcaster clips`);
        targetUsers = [broadcasterName];
      } else {
        console.log(`[BRB] Found ${viewerUsers.length} chatters for viewer clips`);
        targetUsers = viewerUsers;
      }
    } else {
      targetUsers = [broadcasterName];
    }
    
    console.log(`[BRB] Playing clips for: ${targetUsers.join(', ')}`);
    
    for (const user of targetUsers) {
      if (stopRequested || await getCurrentScene() !== scene) break;
      
      console.log(`[BRB] Fetching clips for ${user}...`);
      const clips = await fetchUserClips(user);
      console.log(`[BRB] Found ${clips.length} clips for ${user}`);
      if (clips.length === 0) {
        console.log(`[BRB] No clips found, waiting 5s before retry...`);
        await new Promise(r => setTimeout(r, 5000));
        continue;
      }
      
      const clip = clips[Math.floor(Math.random() * clips.length)];
      const embedUrl = clip.embed_url;
      const duration = Math.floor(clip.duration * 1000) + 700;
      
      const playerUrl = `${process.env.BRB_PLAYER_URL || 'http://127.0.0.1:3100/brb-player'}?user=${clip.broadcaster_name}&image=${clip.thumbnail_url}&video=${embedUrl}&thumbnail_url=${clip.thumbnail_url}&time=${duration}`;
      
      console.log(`[BRB] Setting browser source to: ${playerUrl.substring(0, 100)}...`);
      await setBrowserSource(scene, source, 'about:blank');
      await new Promise(r => setTimeout(r, 50));
      await setBrowserSource(scene, source, playerUrl);
      
      console.log(`[BRB] Playing ${user}'s clip: ${clip.title} (${clip.duration}s)`);
      
      const endTime = Date.now() + duration;
      while (Date.now() < endTime) {
        if (stopRequested || await getCurrentScene() !== scene) break;
        await new Promise(r => setTimeout(r, 1000));
      }
    }
  }
  
  await setBrowserSource(scene, source, 'about:blank');
  isPlaying = false;
  console.log('[BRB] Stopped playing clips');
}

export function stopBRB(): void {
  stopRequested = true;
}

async function fetchUserClips(username: string): Promise<any[]> {
  try {
    const baseUrl = 'http://127.0.0.1:3100';
    const res = await fetch(`${baseUrl}/api/twitch/clips?username=${username}`);
    if (!res.ok) {
      console.error(`[BRB] Clips API error for ${username}: ${res.status}`);
      return [];
    }
    const data = await res.json();
    const clips = data.clips || [];
    console.log(`[BRB] Found ${clips.length} clips for ${username}`);
    return clips;
  } catch (error) {
    console.error(`[BRB] Clips fetch error for ${username}:`, error);
    return [];
  }
}

async function getUserId(username: string): Promise<string> {
  try {
    const baseUrl = 'http://127.0.0.1:3100';
    const res = await fetch(`${baseUrl}/api/twitch/user-id?username=${username}`);
    if (!res.ok) return '';
    const data = await res.json();
    return data.userId || '';
  } catch {
    return '';
  }
}
