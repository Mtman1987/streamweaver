import axios from 'axios';
import { getChatOutputContext } from './chat-output-context';
import { internalServiceHeaders } from '../lib/internal-service-auth';

// In-memory cache for the app access token
let appAccessToken: { token: string; expires: number } | null = null;
let badgeCache: { badges: any, expires: number } | null = null;

function getTwitchClientId(): string {
  const clientId = process.env.NEXT_PUBLIC_TWITCH_CLIENT_ID || process.env.TWITCH_CLIENT_ID;
  if (!clientId) {
    throw new Error('Twitch client ID is missing from environment variables.');
  }
  return clientId;
}

function clearCachedAppAccessToken() {
  appAccessToken = null;
}

/**
 * Gets a Twitch App Access Token using Client Credentials Grant Flow.
 * Caches the token to avoid re-fetching on every request.
 * @returns A valid app access token.
 */
async function getTwitchAppAccessToken(): Promise<string> {
  if (appAccessToken && appAccessToken.expires > Date.now()) {
    return appAccessToken.token;
  }

  let clientId = process.env.NEXT_PUBLIC_TWITCH_CLIENT_ID;
  let clientSecret = process.env.NEXT_PUBLIC_TWITCH_CLIENT_SECRET;

  // Client credentials should be in environment variables
  if (!clientId) {
    clientId = process.env.TWITCH_CLIENT_ID;
  }
  if (!clientSecret) {
    clientSecret = process.env.TWITCH_CLIENT_SECRET;
  }

  if (!clientId || !clientSecret) {
    throw new Error('Twitch client ID or secret is not configured in environment variables.');
  }

  try {
    const response = await axios.post(
      `https://id.twitch.tv/oauth2/token?client_id=${clientId}&client_secret=${clientSecret}&grant_type=client_credentials`
    );

    const { access_token, expires_in } = response.data;
    const now = Date.now();
    // Set expiry to 1 minute before it actually expires, as a buffer
    const expires = now + (expires_in - 60) * 1000;

    appAccessToken = { token: access_token, expires };

    console.log('Successfully fetched new Twitch app access token.');
    return access_token;
  } catch (error: any) {
    console.error('Error fetching Twitch app access token:', error.response?.data || error.message);
    throw new Error('Could not fetch Twitch app access token.');
  }
}


/**
 * Sends a chat message to Twitch via WebSocket server.
 * @param message The message to send.
 * @param as The identity to send the message as ('bot' or 'broadcaster'). Defaults to 'broadcaster'.
 * @param targetChannel Optional explicit channel login.
 * @param tenantId Optional tenant context (required for multi-tenant safety when targetChannel is omitted).
 */
export async function sendChatMessage(
  message: string,
  as: 'bot' | 'broadcaster' = 'broadcaster',
  targetChannel?: string,
  tenantId?: string
): Promise<void> {
  if (tenantId?.startsWith('__kick_silent__')) return;
  const outputContext = getChatOutputContext();
  if (outputContext?.platform === 'discord') {
    const { sendStructuredDiscordReply } = await import('./discord-structured-replies');
    await sendStructuredDiscordReply({
      channelId: outputContext.channelId,
      message,
      tenantId,
      rotateSpeaker: outputContext.speakerMode === 'command',
      sourceMessageId: outputContext.messageId,
      sourceMessage: outputContext.messageContent,
      sourceUser: outputContext.displayName || outputContext.username,
    });
    return;
  }
  try {
    const wsPort = process.env.WS_PORT || '8090';
    const body: any = { message, as, bridgeToDiscord: true };
    if (targetChannel) body.targetChannel = targetChannel.replace(/^#/, '');
    if (tenantId) body.tenantId = tenantId;
    const response = await fetch(`http://localhost:${wsPort}/api/twitch/send-message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    
    if (!response.ok) {
      const payload = await response.json().catch(() => null) as { error?: string } | null;
      throw new Error(payload?.error || `Failed to send message: ${response.statusText}`);
    }
    
    console.log(`[Twitch] Message sent via API: ${message}`);
  } catch (error: any) {
    console.error('[Twitch] Failed to send message:', error);
    const message = String(error?.message || error || '');
    if (/Shared chat source-only send (?:failed|skipped)/i.test(message)) {
      throw new Error(message);
    }
    throw new Error('Twitch client not available for sending messages');
  }
}


type TwitchUser = {
    id: string;
    login: string;
    display_name: string;
    description: string;
    profile_image_url: string;
    created_at?: string;
};

// Get User Information from Twitch API
export async function getTwitchUser(usernameOrId: string, by: "login" | "id" = "login"): Promise<{ id: string; bio: string; lastGame: string; displayName: string; profileImageUrl: string; createdAt?: string; } | null> {
    const clientId = getTwitchClientId();

    try {
        const userQuery = by === 'login' ? `login=${usernameOrId}` : `id=${usernameOrId}`;
        const fetchUserResponse = async () => {
            const appToken = await getTwitchAppAccessToken();
            return fetch(`https://api.twitch.tv/helix/users?${userQuery}`, {
                headers: {
                    'Authorization': `Bearer ${appToken}`,
                    'Client-ID': clientId,
                },
            });
        };

        // Step 1: Get user ID from username
        let userResponse = await fetchUserResponse();
        if (userResponse.status === 401) {
            clearCachedAppAccessToken();
            userResponse = await fetchUserResponse();
        }

        if (!userResponse.ok) {
            const errorBody = await userResponse.text();
            console.error('Failed to fetch Twitch user:', userResponse.status, userResponse.statusText, errorBody);
            throw new Error(`Failed to fetch Twitch user: ${userResponse.statusText}`);
        }

        const userData = await userResponse.json();
        const user: TwitchUser = userData.data[0];

        if (!user) {
            return null;
        }

        const { id, description, display_name, profile_image_url, created_at } = user;

        // Step 2: Get channel information (for last game played)
        const channelAppToken = await getTwitchAppAccessToken();
        const channelResponse = await fetch(`https://api.twitch.tv/helix/channels?broadcaster_id=${id}`, {
            headers: {
                'Authorization': `Bearer ${channelAppToken}`,
                'Client-ID': clientId,
            },
        });

        let gameName = "No recent game played.";
        if (channelResponse.ok) {
            const channelData = await channelResponse.json();
            const channel = channelData.data[0];
            if (channel?.game_name) {
                gameName = channel.game_name;
            }
        } else {
             console.warn('Failed to fetch Twitch channel info for user:', usernameOrId);
        }
        
        return {
            id: id,
            bio: description || "This user has no bio.",
            lastGame: gameName,
            displayName: display_name,
            profileImageUrl: profile_image_url,
            createdAt: created_at,
        };

    } catch (error) {
        console.error('Error fetching Twitch user data:', error);
        throw error;
    }
}

/**
 * Gets Twitch user information by user ID.
 * @param userId The Twitch user ID.
 * @returns A promise that resolves to the user information or null if not found.
 */
export async function getTwitchUserById(userId: string): Promise<{ id: string; bio: string; lastGame: string; displayName: string; profileImageUrl: string; } | null> {
    return getTwitchUser(userId, "id");
}

/**
 * Fetches the chat badges for a specific channel or globally.
 * @param broadcasterId The ID of the broadcaster. If not provided, fetches global badges.
 * @returns A promise that resolves to the badge sets.
 */
export async function getChannelBadges(broadcasterId?: string): Promise<any> {
    const clientId = getTwitchClientId();
    const url = broadcasterId
        ? `https://api.twitch.tv/helix/chat/badges?broadcaster_id=${broadcasterId}`
        : 'https://api.twitch.tv/helix/chat/badges/global';
    
    // Simple in-memory cache for badges to avoid spamming the API
    if (badgeCache && badgeCache.expires > Date.now()) {
        // This is a simplified cache; a real app might need separate caches for global vs channel.
        // For our purpose, we'll just re-fetch if the ID changes. A more robust cache is needed for multiple channels.
        // return badgeCache.badges; 
    }

    try {
        const fetchBadgeResponse = async () => {
            const appToken = await getTwitchAppAccessToken();
            return fetch(url, {
                headers: {
                    'Authorization': `Bearer ${appToken}`,
                    'Client-ID': clientId,
                },
            });
        };

        let response = await fetchBadgeResponse();
        if (response.status === 401) {
            clearCachedAppAccessToken();
            response = await fetchBadgeResponse();
        }

        if (!response.ok) {
            throw new Error(`Failed to fetch Twitch badges: ${response.statusText}`);
        }

        const data = await response.json();
        
        // Flatten the array of badge sets into an object keyed by set_id
        const badgesBySetId = data.data.reduce((acc: any, badgeSet: any) => {
            acc[badgeSet.set_id] = badgeSet.versions.reduce((versionsAcc: any, version: any) => {
                versionsAcc[version.id] = version;
                return versionsAcc;
            }, {});
            return acc;
        }, {});
        
        badgeCache = {
            badges: badgesBySetId,
            expires: Date.now() + 60 * 60 * 1000 // Cache for 1 hour
        };
        
        return badgesBySetId;
    } catch (error) {
        console.error(`Error fetching Twitch badges for ${broadcasterId || 'global'}:`, error);
        throw error;
    }
}


/**
 * Gets follow age for a user in the broadcaster's channel.
 * Uses /helix/channels/followers with broadcaster token.
 */
export async function getFollowAge(username: string, tenantId?: string): Promise<{ followedAt: string } | null> {
  try {
    const { getStoredTokens, ensureValidToken } = require('../lib/token-utils.server');
    const clientId = process.env.TWITCH_CLIENT_ID;
    const clientSecret = process.env.TWITCH_CLIENT_SECRET;
    if (!clientId || !clientSecret) return null;

    const tokens = await getStoredTokens(tenantId);
    if (!tokens) return null;

    const broadcasterToken = await ensureValidToken(clientId, clientSecret, 'broadcaster', tokens, tenantId);

    // Get broadcaster ID from token
    const valRes = await fetch('https://id.twitch.tv/oauth2/validate', {
      headers: { Authorization: `Bearer ${broadcasterToken}` },
    });
    if (!valRes.ok) return null;
    const valData = await valRes.json();
    const broadcasterId = valData.user_id;
    if (!broadcasterId) return null;

    // Get target user ID
    const user = await getTwitchUser(username, 'login');
    if (!user?.id) return null;

    const res = await fetch(
      `https://api.twitch.tv/helix/channels/followers?broadcaster_id=${broadcasterId}&user_id=${user.id}`,
      {
        headers: {
          Authorization: `Bearer ${broadcasterToken}`,
          'Client-ID': clientId,
        },
      }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const follow = data.data?.[0];
    return follow ? { followedAt: follow.followed_at } : null;
  } catch (error) {
    console.error('[Twitch] getFollowAge error:', error);
    return null;
  }
}

/**
 * Gets channel info (follower count, view count) for the authenticated broadcaster.
 */
export async function getChannelInfo(tenantId?: string): Promise<{ followerCount: number; viewCount: number; game: string; title: string } | null> {
  try {
    const { getStoredTokens, ensureValidToken } = require('../lib/token-utils.server');
    const clientId = process.env.TWITCH_CLIENT_ID;
    const clientSecret = process.env.TWITCH_CLIENT_SECRET;
    if (!clientId || !clientSecret) return null;

    const tokens = await getStoredTokens(tenantId);
    if (!tokens) return null;

    const broadcasterToken = await ensureValidToken(clientId, clientSecret, 'broadcaster', tokens, tenantId);

    const valRes = await fetch('https://id.twitch.tv/oauth2/validate', {
      headers: { Authorization: `Bearer ${broadcasterToken}` },
    });
    if (!valRes.ok) return null;
    const valData = await valRes.json();
    const broadcasterId = valData.user_id;
    if (!broadcasterId) return null;

    // Get follower count
    const followRes = await fetch(
      `https://api.twitch.tv/helix/channels/followers?broadcaster_id=${broadcasterId}&first=1`,
      { headers: { Authorization: `Bearer ${broadcasterToken}`, 'Client-ID': clientId } }
    );
    let followerCount = 0;
    if (followRes.ok) {
      const followData = await followRes.json();
      followerCount = followData.total || 0;
    }

    // Get channel info
    const chanRes = await fetch(
      `https://api.twitch.tv/helix/channels?broadcaster_id=${broadcasterId}`,
      { headers: { Authorization: `Bearer ${broadcasterToken}`, 'Client-ID': clientId } }
    );
    let game = '';
    let title = '';
    if (chanRes.ok) {
      const chanData = await chanRes.json();
      game = chanData.data?.[0]?.game_name || '';
      title = chanData.data?.[0]?.title || '';
    }

    // Get user for view count
    const userRes = await fetch(
      `https://api.twitch.tv/helix/users?id=${broadcasterId}`,
      { headers: { Authorization: `Bearer ${broadcasterToken}`, 'Client-ID': clientId } }
    );
    let viewCount = 0;
    if (userRes.ok) {
      const userData = await userRes.json();
      viewCount = userData.data?.[0]?.view_count || 0;
    }

    return { followerCount, viewCount, game, title };
  } catch (error) {
    console.error('[Twitch] getChannelInfo error:', error);
    return null;
  }
}

/**
 * Gets stream uptime if currently live.
 */
export async function getStreamUptime(tenantId?: string): Promise<{ hours: number; minutes: number } | null> {
  try {
    const { getStoredTokens, ensureValidToken } = require('../lib/token-utils.server');
    const clientId = process.env.TWITCH_CLIENT_ID;
    const clientSecret = process.env.TWITCH_CLIENT_SECRET;
    if (!clientId || !clientSecret) return null;

    const tokens = await getStoredTokens(tenantId);
    if (!tokens) return null;

    const broadcasterToken = await ensureValidToken(clientId, clientSecret, 'broadcaster', tokens, tenantId);

    const valRes = await fetch('https://id.twitch.tv/oauth2/validate', {
      headers: { Authorization: `Bearer ${broadcasterToken}` },
    });
    if (!valRes.ok) return null;
    const broadcasterId = (await valRes.json()).user_id;
    if (!broadcasterId) return null;

    const res = await fetch(
      `https://api.twitch.tv/helix/streams?user_id=${broadcasterId}`,
      { headers: { Authorization: `Bearer ${broadcasterToken}`, 'Client-ID': clientId } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const stream = data.data?.[0];
    if (!stream) return null;

    const start = new Date(stream.started_at);
    const diffMs = Date.now() - start.getTime();
    return {
      hours: Math.floor(diffMs / (1000 * 60 * 60)),
      minutes: Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60)),
    };
  } catch (error) {
    console.error('[Twitch] getStreamUptime error:', error);
    return null;
  }
}

/**
 * Updates channel info (game and/or title) via PATCH /helix/channels.
 * Requires channel:manage:broadcast scope.
 */
export async function updateChannelInfo(updates: { game_name?: string; title?: string }, tenantId?: string): Promise<boolean> {
  try {
    const { getStoredTokens, ensureValidToken } = require('../lib/token-utils.server');
    const clientId = process.env.TWITCH_CLIENT_ID;
    const clientSecret = process.env.TWITCH_CLIENT_SECRET;
    if (!clientId || !clientSecret) return false;

    const tokens = await getStoredTokens(tenantId);
    if (!tokens) return false;

    const broadcasterToken = await ensureValidToken(clientId, clientSecret, 'broadcaster', tokens, tenantId);

    const valRes = await fetch('https://id.twitch.tv/oauth2/validate', {
      headers: { Authorization: `Bearer ${broadcasterToken}` },
    });
    if (!valRes.ok) return false;
    const broadcasterId = (await valRes.json()).user_id;
    if (!broadcasterId) return false;

    // If setting game by name, resolve to game_id first
    const body: Record<string, string> = {};
    if (updates.title) body.title = updates.title;
    if (updates.game_name) {
      const gameRes = await fetch(
        `https://api.twitch.tv/helix/games?name=${encodeURIComponent(updates.game_name)}`,
        { headers: { Authorization: `Bearer ${broadcasterToken}`, 'Client-ID': clientId } }
      );
      if (gameRes.ok) {
        const gameData = await gameRes.json();
        const gameId = gameData.data?.[0]?.id;
        if (gameId) body.game_id = gameId;
        else body.game_id = '0'; // Clear game if not found
      }
    }

    const res = await fetch(
      `https://api.twitch.tv/helix/channels?broadcaster_id=${broadcasterId}`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${broadcasterToken}`,
          'Client-ID': clientId,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      }
    );
    return res.ok || res.status === 204;
  } catch (error) {
    console.error('[Twitch] updateChannelInfo error:', error);
    return false;
  }
}

type TwitchBroadcasterContext = {
  clientId: string;
  broadcasterId: string;
  broadcasterToken: string;
};

async function getBroadcasterContext(tenantId?: string): Promise<TwitchBroadcasterContext | null> {
  try {
    const { getStoredTokens, ensureValidToken } = require('../lib/token-utils.server');
    const clientId = process.env.TWITCH_CLIENT_ID;
    const clientSecret = process.env.TWITCH_CLIENT_SECRET;
    if (!clientId || !clientSecret) return null;

    const tokens = await getStoredTokens(tenantId);
    if (!tokens) return null;

    const broadcasterToken = await ensureValidToken(clientId, clientSecret, 'broadcaster', tokens, tenantId);
    const valRes = await fetch('https://id.twitch.tv/oauth2/validate', {
      headers: { Authorization: `Bearer ${broadcasterToken}` },
    });
    if (!valRes.ok) return null;

    const valData = await valRes.json();
    const broadcasterId = String(valData?.user_id || '').trim();
    if (!broadcasterId) return null;

    return { clientId, broadcasterId, broadcasterToken };
  } catch (error) {
    console.error('[Twitch] getBroadcasterContext error:', error);
    return null;
  }
}

function clampTimeoutDuration(seconds: number): number {
  if (!Number.isFinite(seconds)) return 600;
  return Math.max(1, Math.min(1_209_600, Math.floor(seconds)));
}

export async function timeoutUser(username: string, durationSeconds = 600, reason = '', tenantId?: string): Promise<boolean> {
  try {
    const context = await getBroadcasterContext(tenantId);
    if (!context) return false;

    const targetLogin = String(username || '').replace(/^@/, '').trim();
    if (!targetLogin) return false;

    const user = await getTwitchUser(targetLogin, 'login');
    if (!user?.id) return false;

    const res = await fetch(
      `https://api.twitch.tv/helix/moderation/bans?broadcaster_id=${context.broadcasterId}&moderator_id=${context.broadcasterId}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${context.broadcasterToken}`,
          'Client-ID': context.clientId,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          data: {
            user_id: user.id,
            duration: clampTimeoutDuration(durationSeconds),
            reason: String(reason || '').trim().slice(0, 500),
          },
        }),
      }
    );

    if (!res.ok) {
      console.error('[Twitch] timeoutUser failed:', res.status, res.statusText, await res.text().catch(() => ''));
    }

    return res.ok;
  } catch (error) {
    console.error('[Twitch] timeoutUser error:', error);
    return false;
  }
}

export async function banUser(username: string, reason = '', tenantId?: string): Promise<boolean> {
  try {
    const context = await getBroadcasterContext(tenantId);
    if (!context) return false;

    const targetLogin = String(username || '').replace(/^@/, '').trim();
    if (!targetLogin) return false;

    const user = await getTwitchUser(targetLogin, 'login');
    if (!user?.id) return false;

    const res = await fetch(
      `https://api.twitch.tv/helix/moderation/bans?broadcaster_id=${context.broadcasterId}&moderator_id=${context.broadcasterId}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${context.broadcasterToken}`,
          'Client-ID': context.clientId,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          data: {
            user_id: user.id,
            reason: String(reason || '').trim().slice(0, 500),
          },
        }),
      }
    );

    if (!res.ok) {
      console.error('[Twitch] banUser failed:', res.status, res.statusText, await res.text().catch(() => ''));
    }

    return res.ok;
  } catch (error) {
    console.error('[Twitch] banUser error:', error);
    return false;
  }
}

export async function unbanUser(username: string, tenantId?: string): Promise<boolean> {
  try {
    const context = await getBroadcasterContext(tenantId);
    if (!context) return false;

    const targetLogin = String(username || '').replace(/^@/, '').trim();
    if (!targetLogin) return false;

    const user = await getTwitchUser(targetLogin, 'login');
    if (!user?.id) return false;

    const res = await fetch(
      `https://api.twitch.tv/helix/moderation/bans?broadcaster_id=${context.broadcasterId}&moderator_id=${context.broadcasterId}&user_id=${user.id}`,
      {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${context.broadcasterToken}`,
          'Client-ID': context.clientId,
        },
      }
    );

    if (!res.ok) {
      console.error('[Twitch] unbanUser failed:', res.status, res.statusText, await res.text().catch(() => ''));
    }

    return res.ok || res.status === 204;
  } catch (error) {
    console.error('[Twitch] unbanUser error:', error);
    return false;
  }
}


/**
 * Checks if the broadcaster is currently live
 */
export async function checkTwitchLiveStatus(): Promise<void> {
    try {
        const broadcasterId = process.env.TWITCH_BROADCASTER_ID || process.env.NEXT_PUBLIC_HARDCODED_ADMIN_TWITCH_ID;
        if (!broadcasterId) return;
        
        const appToken = await getTwitchAppAccessToken();
        const clientId = getTwitchClientId();
        
        const response = await fetch(`https://api.twitch.tv/helix/streams?user_id=${broadcasterId}`, {
            headers: {
                'Authorization': `Bearer ${appToken}`,
                'Client-ID': clientId,
            },
        });
        
        if (response.ok) {
            const data = await response.json();
            const isLive = data.data && data.data.length > 0;
            
            // Broadcast live status to connected clients
            if (typeof (global as any).broadcast === 'function') {
                (global as any).broadcast({
                    type: 'twitch-live-status',
                    payload: { isLive, stream: data.data[0] || null }
                });
            }
        }
    } catch (error) {
        // Silently handle errors to prevent spam
    }
}

/**
 * Fetches the list of chatters from a Twitch channel via API route.
 * @returns A promise that resolves to an array of chatter objects.
 */
export async function getChatters(tenantId?: string): Promise<{ user_id: string; user_login: string; user_display_name: string; }[]> {
    try {
        const baseUrl = `http://127.0.0.1:${process.env.PORT||3100}`;
        const url = tenantId 
            ? `${baseUrl}/api/chat/chatters?tenant=${tenantId}`
            : `${baseUrl}/api/chat/chatters`;
        const response = await fetch(url, { headers: internalServiceHeaders() });
        
        if (!response.ok) {
            console.warn(`[getChatters] API returned ${response.status}: ${response.statusText}`);
            return [];
        }

        const data = await response.json();
        console.log(`[getChatters] Success: ${data.chatters?.length || 0} chatters`);
        return data.chatters || [];
    } catch (error) {
        console.warn('[getChatters] Fetch error:', error);
        return [];
    }
}
