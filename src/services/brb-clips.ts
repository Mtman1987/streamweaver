import { sendChatMessage } from './twitch';
import { getTwitchUser } from './twitch';
import { readJsonFile, writeJsonFile } from './storage';
import { getStoredTokens, ensureValidToken } from '../lib/token-utils.server';
import { readUserConfig } from '../lib/user-config';
import { isKnownBot } from './known-bots';
import { getExcludedUsers } from './welcome-wagon-tracker';
import { internalServiceHeaders } from '../lib/internal-service-auth';
import { readSharedChatReplay } from './shared-chat-ingestion';
import { recentTwitchChatters } from './brb-viewer-targets';

const runtimeByTenant = new Map<string, { isPlaying: boolean; stopRequested: boolean }>();

const CLIP_MODE_FILE = 'brb-clip-mode.json';

function bc(msg: object, tenantId?: string) {
  if (typeof (global as any).broadcast === 'function') {
    console.log(`[BRB] Broadcasting ${(msg as any).type} to tenant ${tenantId || 'all'}`);
    (global as any).broadcast(msg, tenantId);
  } else {
    console.error('[BRB] global.broadcast is NOT available!');
  }
}

async function getClipModeFromStorage(tenantId?: string): Promise<boolean> {
  const { getMode } = await import('./modes-manager');
  const clipMode = await getMode('clipmode', tenantId);
  return clipMode === 'viewer';
}

async function setClipModeToStorage(useViewerClips: boolean): Promise<void> {
  await writeJsonFile(CLIP_MODE_FILE, { useViewerClips });
}

export async function toggleClipMode(tenantId?: string): Promise<void> {
  const { toggleMode } = await import('./modes-manager');
  await toggleMode('clipmode', tenantId);
}

export async function getClipMode(tenantId?: string): Promise<'broadcaster' | 'viewer'> {
  const { getMode } = await import('./modes-manager');
  const mode = await getMode('clipmode', tenantId);
  return mode === 'viewer' ? 'viewer' : 'broadcaster';
}

async function fetchClipsForUser(username: string): Promise<any[]> {
  try {
    const clientId = process.env.TWITCH_CLIENT_ID;
    const clientSecret = process.env.TWITCH_CLIENT_SECRET;
    if (!clientId || !clientSecret) { console.log('[BRB] Missing Twitch credentials'); return []; }

    const user = await getTwitchUser(username, 'login');
    if (!user?.id) { console.log(`[BRB] User ${username} not found`); return []; }

    const tokenRes = await fetch(
      `https://id.twitch.tv/oauth2/token?client_id=${clientId}&client_secret=${clientSecret}&grant_type=client_credentials`,
      { method: 'POST' }
    );
    const { access_token } = await tokenRes.json();

    const endDate = new Date();
    const startDate = new Date();
    startDate.setFullYear(startDate.getFullYear() - 2);

    const res = await fetch(
      `https://api.twitch.tv/helix/clips?broadcaster_id=${user.id}&started_at=${startDate.toISOString()}&ended_at=${endDate.toISOString()}&first=100`,
      { headers: { 'Authorization': `Bearer ${access_token}`, 'Client-ID': clientId } }
    );

    const data = await res.json();
    console.log(`[BRB] Found ${data.data?.length || 0} clips for ${username}`);
    return data.data || [];
  } catch (err: any) {
    console.error(`[BRB] Clip fetch failed for ${username}:`, err.message);
    return [];
  }
}

async function getChatters(tenantId: string, broadcasterName: string): Promise<string[]> {
  // IRC messages, including !brb itself, are already recorded for this tenant
  // before command dispatch. This path works when broadcaster OAuth is absent.
  const recent = recentTwitchChatters(
    await readSharedChatReplay(tenantId, { limit: 500 }).catch(() => []),
    broadcasterName,
  );

  // The Twitch chatters API can also include quiet viewers when authorized.
  // Avoid calling its auth path if this tenant has no broadcaster credentials.
  const tokens = await getStoredTokens(tenantId).catch(() => null);
  if (!tokens?.broadcasterToken && !tokens?.broadcasterRefreshToken) {
    console.log(`[BRB] Using ${recent.length} recent Twitch chatters; broadcaster token unavailable`);
    return recent;
  }

  try {
    const res = await fetch(`http://127.0.0.1:${process.env.PORT || 3000}/api/chat/chatters?tenant=${encodeURIComponent(tenantId)}`, {
      headers: internalServiceHeaders(),
    });
    if (!res.ok) {
      console.warn(`[BRB] Chatters API returned ${res.status}; using ${recent.length} recent Twitch chatters`);
      return recent;
    }
    const data = await res.json();
    const apiChatters = Array.isArray(data.chatters)
      ? data.chatters.map((c: any) => String(c.user_login || '').toLowerCase()).filter(Boolean)
      : [];
    return [...new Set([...recent, ...apiChatters])];
  } catch {
    console.warn(`[BRB] Chatters API unavailable; using ${recent.length} recent Twitch chatters`);
    return recent;
  }
}

async function getEligibleViewerClipTargets(chatters: string[], broadcasterName: string, tenantId?: string): Promise<string[]> {
  const broadcaster = broadcasterName.toLowerCase();
  const excluded = new Set((await getExcludedUsers(tenantId).catch(() => [])).map(u => u.toLowerCase()));
  const eligible: string[] = [];

  for (const chatter of chatters) {
    const lower = chatter.toLowerCase();
    if (!lower || lower === broadcaster) continue;
    if (excluded.has(lower)) {
      console.log(`[BRB] Skipping ${chatter}: excluded from welcome/shoutout list`);
      continue;
    }
    if (await isKnownBot(lower, tenantId)) {
      console.log(`[BRB] Skipping ${chatter}: known/ignored bot`);
      continue;
    }
    eligible.push(chatter);
  }

  return [...new Set(eligible.map(u => u.toLowerCase()))];
}

export async function startBRB(broadcasterName: string, tenantId?: string): Promise<void> {
  // Resolve tenant from broadcaster name if not provided
  if (!tenantId) {
    try {
      const { getActiveTenantIds } = require('./twitch-client');
      const { getStoredTokens: gst } = require('../lib/token-utils.server');
      for (const tid of getActiveTenantIds()) {
        const tokens = await gst(tid);
        if (tokens?.broadcasterUsername?.toLowerCase() === broadcasterName.toLowerCase()) { tenantId = tid; break; }
      }
    } catch {}
  }
  if (!tenantId) throw new Error('BRB playback requires tenant context');
  const runtime = runtimeByTenant.get(tenantId) || { isPlaying: false, stopRequested: false };
  runtimeByTenant.set(tenantId, runtime);
  if (runtime.isPlaying) { console.log(`[BRB:${tenantId}] Already playing`); return; }

  runtime.isPlaying = true;
  runtime.stopRequested = false;
  console.log(`[BRB] Starting for ${broadcasterName}, tenant ${tenantId}`);

  const { getConfigSection } = require('../lib/local-config/service');
  const obsConfig = await getConfigSection('obs', tenantId);
  const scene = obsConfig?.scenes?.brb || 'BRB';
  const liveScene = obsConfig?.scenes?.live || 'Live';

  const loungeBRB = tenantId === 'spacemountainlive';
  if (!loungeBRB) bc({ type: 'obs-switch-scene', payload: { sceneName: scene } }, tenantId);
  bc({ type: 'brb-start', payload: { scene } }, tenantId);

  await new Promise(r => setTimeout(r, 2000));

  let spotlightActive = false;
  let noMediaNotified = false;
  while (!runtime.stopRequested) {
    const useViewerClips = await getClipModeFromStorage(tenantId);
    let targetUsers: string[];

    if (useViewerClips) {
      const chatters = await getChatters(tenantId, broadcasterName);
      const viewers = await getEligibleViewerClipTargets(chatters, broadcasterName, tenantId);
      targetUsers = viewers.length > 0 ? viewers : [broadcasterName];
      console.log(`[BRB] Viewer mode: ${targetUsers.length} targets`);
    } else {
      targetUsers = [broadcasterName];
      console.log(`[BRB] Broadcaster mode: ${broadcasterName}`);
    }

    let playedClip = false;
    for (const user of targetUsers) {
      if (runtime.stopRequested) break;

      console.log(`[BRB] Fetching clips for ${user}...`);
      const clips = await fetchClipsForUser(user);
      if (clips.length === 0) {
        console.log(`[BRB] No clips for ${user}`);
        continue;
      }

      playedClip = true;
      noMediaNotified = false;
      spotlightActive = false;
      const clip = clips[Math.floor(Math.random() * clips.length)];
      const embedUrl = clip.url.replace('twitch.tv/', 'twitch.tv/embed?clip=');
      const duration = Math.floor((clip.duration || 30) * 1000) + 700;

      console.log(`[BRB] Playing clip: ${clip.title} (${clip.duration}s) for ${user}`);

      bc({
        type: 'brb-clip',
        payload: { clipUrl: embedUrl, thumbnailUrl: clip.thumbnail_url, user: clip.broadcaster_name || user, duration }
      }, tenantId);

      const endTime = Date.now() + duration + 2000;
      while (Date.now() < endTime && !runtime.stopRequested) {
        await new Promise(r => setTimeout(r, 1000));
      }
    }

    if (!playedClip && !runtime.stopRequested && loungeBRB) {
      let liveSpotlight = false;
      try {
        const response = await fetch('https://discord-stream-hub-new.fly.dev/api/community-spotlight', {
          signal: AbortSignal.timeout(5000),
          cache: 'no-store',
        });
        if (response.ok) {
          const data = await response.json();
          liveSpotlight = Boolean(data?.spotlight?.twitchLogin);
        }
      } catch (error) {
        console.warn('[BRB] Community Spotlight lookup failed:', error);
      }
      if (liveSpotlight && !spotlightActive) {
        bc({ type: 'brb-spotlight' }, tenantId);
        spotlightActive = true;
        noMediaNotified = false;
        console.log('[BRB] No clips available; showing live Community Spotlight');
      } else if (!liveSpotlight && spotlightActive) {
        bc({ type: 'brb-no-media' }, tenantId);
        spotlightActive = false;
        noMediaNotified = true;
      } else if (!liveSpotlight && !noMediaNotified) {
        bc({ type: 'brb-no-media' }, tenantId);
        noMediaNotified = true;
        console.warn('[BRB] No clips or live Spotlight; keeping the Lounge visible');
      }
      const retryAt = Date.now() + 15_000;
      while (Date.now() < retryAt && !runtime.stopRequested) {
        await new Promise(r => setTimeout(r, 1000));
      }
    } else if (!playedClip && !runtime.stopRequested) {
      await new Promise(r => setTimeout(r, 5000));
    }
  }

  bc({ type: 'brb-stop' }, tenantId);
  if (!loungeBRB) bc({ type: 'obs-switch-scene', payload: { sceneName: liveScene } }, tenantId);

  runtime.isPlaying = false;
  console.log('[BRB] Stopped');
}

export function stopBRB(tenantId?: string): void {
  if (!tenantId) {
    if (process.env.NODE_ENV === 'production') throw new Error('Stopping BRB requires tenant context');
    return;
  }
  const runtime = runtimeByTenant.get(tenantId);
  if (runtime) runtime.stopRequested = true;
}
