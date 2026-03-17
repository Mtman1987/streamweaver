/**
 * Shared Chat Detection & Source-Only Messaging
 *
 * When a streamer is in a Twitch shared-chat session, normal client.say()
 * messages get mirrored to every participant. This module detects shared
 * chat and uses the Twitch Helix API with `for_source_only: true` so the
 * bot message only appears in the originating channel.
 *
 * Falls back to normal IRC if the API call fails.
 */

import { promises as fs } from 'fs';
import { resolve } from 'path';

let appAccessToken: string | null = null;
let appTokenExpiry = 0;

// ---------------------------------------------------------------------------
// Chat mode: 'single' (default) ignores mirrored messages,
//            'shared' processes them like normal.
// ---------------------------------------------------------------------------

export type ChatMode = 'single' | 'shared';
let chatMode: ChatMode = 'single';
const CHAT_MODE_FILE = resolve(process.cwd(), 'data', 'chat-mode.json');

async function loadChatMode(): Promise<void> {
  try {
    const raw = await fs.readFile(CHAT_MODE_FILE, 'utf-8');
    const data = JSON.parse(raw);
    if (data.mode === 'shared' || data.mode === 'single') chatMode = data.mode;
  } catch {}
}

async function saveChatMode(): Promise<void> {
  try {
    await fs.mkdir(resolve(process.cwd(), 'data'), { recursive: true });
    await fs.writeFile(CHAT_MODE_FILE, JSON.stringify({ mode: chatMode }));
  } catch {}
}

// Load on module init
loadChatMode();

export function getChatMode(): ChatMode {
  return chatMode;
}

export async function toggleChatMode(): Promise<ChatMode> {
  chatMode = chatMode === 'single' ? 'shared' : 'single';
  await saveChatMode();
  return chatMode;
}

/**
 * Returns true if a mirrored message should be ignored based on current mode.
 */
export function shouldIgnoreMirrored(tags: Record<string, any>): boolean {
  return chatMode === 'single' && isMirroredSharedMessage(tags);
}

// Cache shared-chat status per channel (refreshed every 60s)
const sharedChatCache = new Map<string, { isShared: boolean; expires: number }>();
const CACHE_TTL = 60_000;

// Cooldown for "please /mod the bot" warnings (once per channel per 24h)
const SOURCE_WARN_COOLDOWN = 24 * 60 * 60 * 1000;
const sourceWarnedAt = new Map<string, number>();

// Room-ID → login lookup cache (permanent, IDs don't change)
const roomIdToLogin = new Map<string, string>();

// ---------------------------------------------------------------------------
// Token helpers
// ---------------------------------------------------------------------------

async function getAppToken(): Promise<string> {
  if (appAccessToken && Date.now() < appTokenExpiry) return appAccessToken;

  const clientId = process.env.TWITCH_CLIENT_ID || process.env.NEXT_PUBLIC_TWITCH_CLIENT_ID;
  const clientSecret = process.env.TWITCH_CLIENT_SECRET || process.env.NEXT_PUBLIC_TWITCH_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error('Twitch client credentials not configured');

  const res = await fetch('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  const data = await res.json();
  if (!data.access_token) throw new Error('Failed to get app access token');

  appAccessToken = data.access_token;
  appTokenExpiry = Date.now() + (data.expires_in - 120) * 1000;
  return appAccessToken!;
}

function getClientId(): string {
  return process.env.TWITCH_CLIENT_ID || process.env.NEXT_PUBLIC_TWITCH_CLIENT_ID || '';
}

// ---------------------------------------------------------------------------
// Shared-chat detection
// ---------------------------------------------------------------------------

/**
 * Check if a channel is currently in a shared-chat session via Helix.
 */
export async function isChannelInSharedChat(channelLogin: string): Promise<boolean> {
  const key = channelLogin.toLowerCase();
  const cached = sharedChatCache.get(key);
  if (cached && Date.now() < cached.expires) return cached.isShared;

  try {
    const token = await getAppToken();
    const clientId = getClientId();

    // Resolve login → user ID
    const userRes = await fetch(
      `https://api.twitch.tv/helix/users?login=${encodeURIComponent(key)}`,
      { headers: { 'Client-ID': clientId, Authorization: `Bearer ${token}` } },
    );
    const userData = await userRes.json();
    const broadcasterId = userData.data?.[0]?.id;
    if (!broadcasterId) {
      sharedChatCache.set(key, { isShared: false, expires: Date.now() + CACHE_TTL });
      return false;
    }

    // Check shared chat session
    const scRes = await fetch(
      `https://api.twitch.tv/helix/shared_chat/session?broadcaster_id=${broadcasterId}`,
      { headers: { 'Client-ID': clientId, Authorization: `Bearer ${token}` } },
    );

    if (scRes.status === 404 || scRes.status === 204) {
      sharedChatCache.set(key, { isShared: false, expires: Date.now() + CACHE_TTL });
      return false;
    }

    const scData = await scRes.json();
    const isShared = Boolean(scData?.data?.session_id || scData?.data?.participants?.length);
    sharedChatCache.set(key, { isShared, expires: Date.now() + CACHE_TTL });
    return isShared;
  } catch (e) {
    console.error(`[SharedChat] Detection failed for ${key}:`, e);
    sharedChatCache.set(key, { isShared: false, expires: Date.now() + CACHE_TTL });
    return false;
  }
}

// ---------------------------------------------------------------------------
// Source-only message via Helix API
// ---------------------------------------------------------------------------

async function sendViaHelixAPI(
  targetChannel: string,
  senderLogin: string,
  message: string,
  attempt = 0,
): Promise<{ success: boolean; reason?: string }> {
  try {
    const token = await getAppToken();
    const clientId = getClientId();

    // Resolve broadcaster ID
    const bRes = await fetch(
      `https://api.twitch.tv/helix/users?login=${encodeURIComponent(targetChannel)}`,
      { headers: { 'Client-ID': clientId, Authorization: `Bearer ${token}` } },
    );
    const bData = await bRes.json();
    const broadcasterId = bData.data?.[0]?.id;
    if (!broadcasterId) return { success: false, reason: 'broadcaster-not-found' };

    // Resolve sender ID
    const sRes = await fetch(
      `https://api.twitch.tv/helix/users?login=${encodeURIComponent(senderLogin)}`,
      { headers: { 'Client-ID': clientId, Authorization: `Bearer ${token}` } },
    );
    const sData = await sRes.json();
    const senderId = sData.data?.[0]?.id;
    if (!senderId) return { success: false, reason: 'sender-not-found' };

    const res = await fetch('https://api.twitch.tv/helix/chat/messages', {
      method: 'POST',
      headers: {
        'Client-ID': clientId,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        broadcaster_id: broadcasterId,
        sender_id: senderId,
        message,
        for_source_only: true,
      }),
    });

    if (res.ok) return { success: true };

    const errText = await res.text();
    console.warn(`[SharedChat] Helix send failed (${res.status}): ${errText}`);

    // Permission error — don't retry
    const lower = errText.toLowerCase();
    if (
      lower.includes('channel:bot') ||
      lower.includes('sender must be a moderator') ||
      lower.includes('must have authorized')
    ) {
      return { success: false, reason: 'permission' };
    }

    // Token expired — refresh once
    if (res.status === 401 && attempt < 1) {
      appAccessToken = null;
      return sendViaHelixAPI(targetChannel, senderLogin, message, attempt + 1);
    }

    return { success: false, reason: 'api-error' };
  } catch (e: any) {
    console.error('[SharedChat] Helix send error:', e.message);
    return { success: false, reason: 'exception' };
  }
}

// ---------------------------------------------------------------------------
// Public: send with shared-chat awareness
// ---------------------------------------------------------------------------

export interface SendOptions {
  /** The tmi.js client to fall back to */
  client: any;
  /** Channel to send to (no # prefix) */
  channel: string;
  /** Message text */
  message: string;
  /** Which identity is sending ('bot' | 'broadcaster') */
  as: 'bot' | 'broadcaster';
}

/**
 * Send a chat message with shared-chat awareness.
 * If the channel is in shared chat, tries Helix API with source-only first.
 * Falls back to normal client.say() if API fails or channel is not shared.
 */
export async function sendWithSharedChatAwareness(opts: SendOptions): Promise<void> {
  const { client, channel, message, as } = opts;
  const normalized = channel.toLowerCase().replace(/^#/, '');

  const inShared = await isChannelInSharedChat(normalized);

  if (inShared) {
    // Determine sender login
    let senderLogin: string;
    if (as === 'bot') {
      senderLogin = (
        process.env.NEXT_PUBLIC_TWITCH_BOT_USERNAME ||
        process.env.TWITCH_BOT_USERNAME ||
        ''
      ).toLowerCase();
    } else {
      senderLogin = (
        process.env.TWITCH_BROADCASTER_USERNAME ||
        process.env.NEXT_PUBLIC_TWITCH_BROADCASTER_USERNAME ||
        ''
      ).toLowerCase();
    }

    if (senderLogin) {
      const result = await sendViaHelixAPI(normalized, senderLogin, message);
      if (result.success) {
        console.log(`[SharedChat] Source-only message sent to ${normalized}`);
        return;
      }

      console.warn(`[SharedChat] API fallback to IRC for ${normalized} (${result.reason})`);

      // One-time warning about /mod
      if (result.reason === 'permission') {
        const lastWarn = sourceWarnedAt.get(normalized) || 0;
        if (Date.now() - lastWarn > SOURCE_WARN_COOLDOWN) {
          sourceWarnedAt.set(normalized, Date.now());
          try {
            await client.say(
              `#${normalized}`,
              `Shared chat tip: /mod ${senderLogin} to reduce mirrored bot messages.`,
            );
          } catch {}
        }
      }
    }
  }

  // Normal IRC send
  await client.say(`#${normalized}`, message);
}

// ---------------------------------------------------------------------------
// Incoming message helpers (for deduplicating mirrored messages)
// ---------------------------------------------------------------------------

/**
 * Returns true if the incoming TMI message is a mirrored shared-chat message
 * (i.e. it originated from a different channel than the one we received it in).
 */
export function isMirroredSharedMessage(tags: Record<string, any>): boolean {
  const roomId = tags['room-id'];
  const sourceRoomId = tags['source-room-id'] || tags['source-id'];
  return Boolean(roomId && sourceRoomId && roomId !== sourceRoomId);
}

/**
 * Resolve a room-id to a channel login via Helix (cached permanently).
 */
export async function resolveRoomIdToLogin(roomId: string, fallback: string): Promise<string> {
  const key = String(roomId).trim();
  if (!key) return fallback;
  if (roomIdToLogin.has(key)) return roomIdToLogin.get(key)!;

  try {
    const token = await getAppToken();
    const clientId = getClientId();
    const res = await fetch(
      `https://api.twitch.tv/helix/users?id=${encodeURIComponent(key)}`,
      { headers: { 'Client-ID': clientId, Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) return fallback;
    const data = await res.json();
    const login = data?.data?.[0]?.login?.toLowerCase();
    if (!login) return fallback;
    roomIdToLogin.set(key, login);
    return login;
  } catch {
    return fallback;
  }
}

/**
 * Force-clear the shared chat cache for a channel (useful after detecting
 * a session start/end via EventSub).
 */
export function invalidateSharedChatCache(channelLogin: string): void {
  sharedChatCache.delete(channelLogin.toLowerCase());
}
