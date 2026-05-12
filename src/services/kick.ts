/**
 * Kick.com Chat Integration Service
 * Handles Kick API and WebSocket connections for live streaming
 */

import { EventEmitter } from 'events';
import { promises as fs } from 'fs';
import { tenantPath } from '../lib/tenant';

export interface KickMessage {
  id: string;
  username: string;
  displayName: string;
  message: string;
  timestamp: Date;
  badges: string[];
  isSubscriber: boolean;
  isModerator: boolean;
  isOwner: boolean;
}

export interface KickSubscription {
  username: string;
  months: number;
  tier: number;
}

interface KickTokens {
  accessToken: string;
  refreshToken: string;
  tokenExpiry: number;
  username: string;
  channelId: string;
  chatroomId: string;
}

export class KickService extends EventEmitter {
  private pusher: any;
  private channel: any;
  private channelName: string | null = null;
  private channelId: number | null = null;
  private chatroomId: number | null = null;
  private connected: boolean = false;
  private tenantId: string | null = null;
  private tokens: KickTokens | null = null;

  constructor() {
    super();
  }

  /**
   * Load stored tokens for a tenant (bot token preferred, then global community bot)
   */
  async loadTokens(tenantId: string): Promise<KickTokens | null> {
    try {
      const tokensFile = tenantPath(tenantId, 'tokens/kick-tokens.json');
      const data = JSON.parse(await fs.readFile(tokensFile, 'utf-8'));

      // Prefer tenant's own bot token
      if (data.botToken) {
        return {
          accessToken: data.botToken,
          refreshToken: data.botRefreshToken,
          tokenExpiry: data.botTokenExpiry,
          username: data.botUsername || '',
          channelId: data.broadcasterChannelId || data.botChannelId || '',
          chatroomId: data.broadcasterChatroomId || data.botChatroomId || '',
        };
      }

      // Fall back to broadcaster token for sending
      if (data.broadcasterToken) {
        return {
          accessToken: data.broadcasterToken,
          refreshToken: data.broadcasterRefreshToken,
          tokenExpiry: data.broadcasterTokenExpiry,
          username: data.broadcasterUsername || '',
          channelId: data.broadcasterChannelId || '',
          chatroomId: data.broadcasterChatroomId || '',
        };
      }
    } catch {}

    // Fall back to global community bot
    try {
      const { globalPath: gp } = require('../lib/tenant');
      const globalFile = gp('kick-bot-tokens.json');
      const data = JSON.parse(await fs.readFile(globalFile, 'utf-8'));
      if (data.accessToken) {
        return {
          accessToken: data.accessToken,
          refreshToken: data.refreshToken,
          tokenExpiry: data.tokenExpiry,
          username: data.username || 'streamweaverbot',
          channelId: data.channelId || '',
          chatroomId: '', // Will use the broadcaster's chatroom
        };
      }
    } catch {}

    return null;
  }

  /**
   * Refresh the access token
   */
  private async refreshAccessToken(): Promise<boolean> {
    if (!this.tokens?.refreshToken || !this.tenantId) return false;

    const clientId = process.env.KICK_CLIENT_ID;
    const clientSecret = process.env.KICK_CLIENT_SECRET;
    if (!clientId || !clientSecret) return false;

    try {
      const res = await fetch('https://id.kick.com/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          grant_type: 'refresh_token',
          refresh_token: this.tokens.refreshToken,
        }),
      });

      if (!res.ok) {
        console.error('[Kick] Token refresh failed:', res.status);
        return false;
      }

      const data = await res.json();
      this.tokens.accessToken = data.access_token;
      this.tokens.refreshToken = data.refresh_token || this.tokens.refreshToken;
      this.tokens.tokenExpiry = Date.now() + (data.expires_in - 60) * 1000;

      // Persist updated tokens
      const tokensFile = tenantPath(this.tenantId, 'tokens/kick-tokens.json');
      await fs.writeFile(tokensFile, JSON.stringify({ ...this.tokens, lastUpdated: new Date().toISOString() }, null, 2));
      console.log('[Kick] ✅ Token refreshed');
      return true;
    } catch (error) {
      console.error('[Kick] Token refresh error:', error);
      return false;
    }
  }

  /**
   * Get a valid access token, refreshing if needed
   */
  private async getValidToken(): Promise<string | null> {
    if (!this.tokens) return null;
    if (Date.now() >= this.tokens.tokenExpiry) {
      const refreshed = await this.refreshAccessToken();
      if (!refreshed) return null;
    }
    return this.tokens.accessToken;
  }

  /**
   * Connect to Kick channel chat with optional tenant auth
   */
  async connect(channelName: string, tenantId?: string): Promise<void> {
    try {
      this.channelName = channelName;
      this.tenantId = tenantId || null;

      // Load tokens if tenant provided
      if (tenantId) {
        this.tokens = await this.loadTokens(tenantId);
        if (this.tokens) {
          console.log(`[Kick] Loaded tokens for ${this.tokens.username}`);
          const parsedChatroom = parseInt(this.tokens.chatroomId);
          const parsedChannel = parseInt(this.tokens.channelId);
          if (!isNaN(parsedChatroom) && parsedChatroom > 0) this.chatroomId = parsedChatroom;
          if (!isNaN(parsedChannel) && parsedChannel > 0) this.channelId = parsedChannel;
        }
      }

      // If we still don't have chatroom ID, try to resolve it
      if (!this.chatroomId) {
        console.log(`[Kick] No chatroom ID stored, resolving for channel: ${channelName}`);
        const channelInfo = await this.getChannelInfo(channelName);
        if (channelInfo) {
          this.channelId = channelInfo.id || this.channelId;
          this.chatroomId = channelInfo.chatroom?.id || channelInfo.chatroom_id || null;
        }
        if (!this.chatroomId) {
          throw new Error(`Could not resolve chatroom ID for ${channelName}. Re-authorize Kick Broadcaster to fix.`);
        }
        // Persist the resolved chatroom ID so we don't need to look it up again
        if (tenantId) {
          try {
            const tokensFile = tenantPath(tenantId, 'tokens/kick-tokens.json');
            const existing = JSON.parse(await fs.readFile(tokensFile, 'utf-8'));
            existing.broadcasterChatroomId = String(this.chatroomId);
            if (this.channelId) existing.broadcasterChannelId = String(this.channelId);
            await fs.writeFile(tokensFile, JSON.stringify(existing, null, 2));
            console.log(`[Kick] Persisted chatroom ID: ${this.chatroomId}`);
          } catch {}
        }
      }

      // Connect via Pusher (Kick uses Pusher for WebSocket)
      // eslint-disable-next-line no-eval
      const PusherModule = eval('require')('pusher-js');
      const PusherClient = PusherModule.Pusher || PusherModule.default || PusherModule;
      this.pusher = new PusherClient('32cbd69e4b950bf97679', {
        cluster: 'us2',
        wsHost: 'ws-us2.pusher.com',
        wsPort: 443,
        wssPort: 443,
        enabledTransports: ['ws', 'wss'],
        forceTLS: true
      });

      const channelKey = `chatrooms.${this.chatroomId}.v2`;
      this.channel = this.pusher.subscribe(channelKey);

      this.channel.bind('App\Events\ChatMessageEvent', (data: any) => {
        const message = this.parseMessage(data);
        if (message) this.emit('message', message);
      });

      this.channel.bind('App\Events\SubscriptionEvent', (data: any) => {
        const sub = this.parseSubscription(data);
        if (sub) this.emit('subscription', sub);
      });

      this.channel.bind('App\Events\FollowersUpdated', (data: any) => {
        this.emit('follow', { username: data.username, followed: data.followed });
      });

      this.channel.bind('App\Events\GiftsLeaderboardUpdated', (data: any) => {
        this.emit('gift', data);
      });

      this.connected = true;
      console.log(`[Kick] ✅ Connected to channel: ${channelName} (chatroom: ${this.chatroomId})`);
      this.emit('connected');
    } catch (error) {
      console.error('[Kick] Connection error:', error);
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Get channel information from Kick API
   * Uses /public/v1/users/me (authenticated) since public v2 is blocked from servers
   */
  private async getChannelInfo(channelName: string): Promise<any> {
    // Ensure we have a valid (non-expired) token
    const token = await this.getValidToken();
    if (token) {
      try {
        console.log('[Kick] Calling /public/v1/users/me to resolve chatroom...');
        const res = await fetch('https://api.kick.com/public/v1/users/me', {
          headers: { 'Authorization': `Bearer ${token}` },
        });
        if (res.ok) {
          const data = await res.json();
          const user = data.data || data;
          const chatroomId = user.chatroom_id || user.chatroom?.id;
          const channelId = user.channel_id || user.id;
          console.log(`[Kick] /users/me resolved: channel=${channelId}, chatroom=${chatroomId}, username=${user.username}`);
          if (channelId && chatroomId) {
            return { id: channelId, chatroom: { id: chatroomId } };
          }
          console.warn('[Kick] /users/me response missing chatroom_id. Full response:', JSON.stringify(user).slice(0, 500));
        } else {
          console.warn(`[Kick] /users/me returned ${res.status}: ${await res.text().catch(() => '')}`);
        }
      } catch (e) {
        console.warn('[Kick] /users/me lookup failed:', e);
      }
    } else {
      console.warn('[Kick] No valid token available for /users/me lookup');
    }

    // Fallback: public v2 API (blocked from most server IPs)
    try {
      const response = await fetch(`https://kick.com/api/v2/channels/${channelName}`, {
        headers: { 'Accept': 'application/json' },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      console.error('[Kick] Public channel info fetch failed:', error);
      return null;
    }
  }

  /**
   * Parse Kick message event
   */
  private parseMessage(data: any): KickMessage | null {
    try {
      const sender = data.sender;
      const badges: string[] = [];
      if (sender.identity?.badges) {
        for (const badge of sender.identity.badges) badges.push(badge.type);
      }
      return {
        id: data.id,
        username: sender.slug,
        displayName: sender.username,
        message: data.content,
        timestamp: new Date(data.created_at),
        badges,
        isSubscriber: badges.includes('subscriber'),
        isModerator: badges.includes('moderator'),
        isOwner: badges.includes('broadcaster')
      };
    } catch (error) {
      console.error('[Kick] Error parsing message:', error);
      return null;
    }
  }

  /**
   * Parse subscription event
   */
  private parseSubscription(data: any): KickSubscription | null {
    try {
      return { username: data.username, months: data.months || 1, tier: data.tier || 1 };
    } catch {
      return null;
    }
  }

  /**
   * Send a message to Kick chat (authenticated)
   */
  async sendChatMessage(message: string): Promise<void> {
    if (!this.connected || !this.chatroomId) {
      throw new Error('Not connected to Kick');
    }

    const token = await this.getValidToken();
    if (!token) {
      console.warn('[Kick] ⚠️ No valid token — cannot send message');
      return;
    }

    try {
      const res = await fetch(`https://api.kick.com/public/v1/chat`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          chatroom_id: this.chatroomId,
          content: message,
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        // If public API fails, try v2 endpoint
        if (res.status === 404 || res.status === 401) {
          const v2Res = await fetch(`https://kick.com/api/v2/messages/send/${this.chatroomId}`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ content: message, type: 'message' }),
          });
          if (!v2Res.ok) {
            console.error(`[Kick] v2 send also failed (${v2Res.status}):`, await v2Res.text().catch(() => ''));
          }
          return;
        }
        console.error(`[Kick] Send message failed (${res.status}):`, errText);
        // Try token refresh on 401
        if (res.status === 401) {
          const refreshed = await this.refreshAccessToken();
          if (refreshed) {
            // Retry once
            const retryRes = await fetch('https://api.kick.com/public/v1/chat', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${this.tokens!.accessToken}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ chatroom_id: this.chatroomId, content: message }),
            });
            if (!retryRes.ok) console.error('[Kick] Retry send failed:', retryRes.status);
          }
        }
      }
    } catch (error) {
      console.error('[Kick] Error sending message:', error);
    }
  }

  /**
   * Timeout a user
   */
  async timeoutUser(username: string, duration: number = 600): Promise<void> {
    const token = await this.getValidToken();
    if (!token || !this.channelId) return;

    try {
      await fetch(`https://api.kick.com/public/v1/channels/${this.channelId}/chat/timeout`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, duration }),
      });
    } catch (error) {
      console.error('[Kick] Timeout user error:', error);
    }
  }

  /**
   * Ban a user
   */
  async banUser(username: string): Promise<void> {
    const token = await this.getValidToken();
    if (!token || !this.channelId) return;

    try {
      await fetch(`https://api.kick.com/public/v1/channels/${this.channelId}/chat/ban`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ username }),
      });
    } catch (error) {
      console.error('[Kick] Ban user error:', error);
    }
  }

  /**
   * Disconnect from Kick
   */
  disconnect() {
    if (this.channel) {
      this.channel.unbind_all();
      this.pusher.unsubscribe(this.channel.name);
    }
    if (this.pusher) this.pusher.disconnect();
    this.connected = false;
    this.channelName = null;
    this.channelId = null;
    this.chatroomId = null;
    this.tokens = null;
    this.tenantId = null;
    console.log('[Kick] Disconnected');
    this.emit('disconnected');
  }

  isConnected(): boolean {
    return this.connected;
  }

  hasAuth(): boolean {
    return this.tokens !== null;
  }

  getChannelName(): string | null {
    return this.channelName;
  }

  getTenantId(): string | null {
    return this.tenantId;
  }
}

// Per-tenant instances
const kickInstances = new Map<string, KickService>();

export function getKickService(tenantId?: string): KickService {
  const key = tenantId || 'global';
  let instance = kickInstances.get(key);
  if (!instance) {
    instance = new KickService();
    kickInstances.set(key, instance);
  }
  return instance;
}

export function getKickServiceForTenant(tenantId: string): KickService | undefined {
  return kickInstances.get(tenantId);
}

export function getAllKickInstances(): Map<string, KickService> {
  return kickInstances;
}
