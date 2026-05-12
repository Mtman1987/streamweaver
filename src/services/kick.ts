/**
 * Kick.com Chat Integration Service
 * Handles Kick API and WebSocket connections for live streaming
 */

import { EventEmitter } from 'events';
import Pusher from 'pusher-js';
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
   * Load stored tokens for a tenant
   */
  async loadTokens(tenantId: string): Promise<KickTokens | null> {
    try {
      const tokensFile = tenantPath(tenantId, 'tokens/kick-tokens.json');
      const data = await fs.readFile(tokensFile, 'utf-8');
      return JSON.parse(data);
    } catch {
      return null;
    }
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
          if (this.tokens.chatroomId) {
            this.chatroomId = parseInt(this.tokens.chatroomId);
          }
          if (this.tokens.channelId) {
            this.channelId = parseInt(this.tokens.channelId);
          }
        }
      }

      // Get channel info from Kick public API if we don't have IDs
      if (!this.chatroomId) {
        const channelInfo = await this.getChannelInfo(channelName);
        if (!channelInfo) throw new Error('Channel not found');
        this.channelId = channelInfo.id;
        this.chatroomId = channelInfo.chatroom?.id;
        if (!this.chatroomId) throw new Error('Chatroom not found');
      }

      // Connect via Pusher (Kick uses Pusher for WebSocket)
      this.pusher = new Pusher('eb1d5f283081a78b932c', {
        cluster: 'us2',
        wsHost: 'ws-us2.pusher.com',
        wsPort: 443,
        wssPort: 443,
        enabledTransports: ['ws', 'wss'],
        forceTLS: true
      });

      const channelKey = `chatrooms.${this.chatroomId}.v2`;
      this.channel = this.pusher.subscribe(channelKey);

      this.channel.bind('App\\Events\\ChatMessageEvent', (data: any) => {
        const message = this.parseMessage(data);
        if (message) this.emit('message', message);
      });

      this.channel.bind('App\\Events\\SubscriptionEvent', (data: any) => {
        const sub = this.parseSubscription(data);
        if (sub) this.emit('subscription', sub);
      });

      this.channel.bind('App\\Events\\FollowersUpdated', (data: any) => {
        this.emit('follow', { username: data.username, followed: data.followed });
      });

      this.channel.bind('App\\Events\\GiftsLeaderboardUpdated', (data: any) => {
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
   */
  private async getChannelInfo(channelName: string): Promise<any> {
    try {
      const response = await fetch(`https://kick.com/api/v2/channels/${channelName}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      console.error('[Kick] Error fetching channel info:', error);
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
      const res = await fetch('https://api.kick.com/public/v1/chat', {
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
