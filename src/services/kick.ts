/**
 * Kick.com Chat Integration Service
 * Handles Kick API and WebSocket connections for live streaming
 */

import { EventEmitter } from 'events';
import { promises as fs } from 'fs';
import { tenantPath } from '../lib/tenant';

// pusher-js exports { Pusher } as a named export in Node.js
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { Pusher: PusherClient } = require('pusher-js');

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
  private reconnectTimer: NodeJS.Timeout | null = null;
  private broadcasterUserId: number | null = null;
  private messageCount: number = 0;

  constructor() {
    super();
  }

  /**
   * Load stored tokens for a tenant (bot token preferred, then global community bot)
   */
  async loadTokens(tenantId: string): Promise<KickTokens | null> {
    let tenantData: Record<string, any> = {};
    try {
      const tokensFile = tenantPath(tenantId, 'tokens/kick-tokens.json');
      tenantData = JSON.parse(await fs.readFile(tokensFile, 'utf-8'));

      // Prefer tenant's own bot token
      if (tenantData.botToken) {
        return {
          accessToken: tenantData.botToken,
          refreshToken: tenantData.botRefreshToken,
          tokenExpiry: tenantData.botTokenExpiry,
          username: tenantData.botUsername || '',
          channelId: tenantData.broadcasterChannelId || tenantData.botChannelId || '',
          chatroomId: tenantData.broadcasterChatroomId || tenantData.botChatroomId || '',
        };
      }

      // Fall back to broadcaster token for sending
      if (tenantData.broadcasterToken) {
        return {
          accessToken: tenantData.broadcasterToken,
          refreshToken: tenantData.broadcasterRefreshToken,
          tokenExpiry: tenantData.broadcasterTokenExpiry,
          username: tenantData.broadcasterUsername || '',
          channelId: tenantData.broadcasterChannelId || '',
          chatroomId: tenantData.broadcasterChatroomId || '',
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
          // Listening can use tenant-owned channel metadata with the shared
          // community bot token. Keep those two storage scopes joined here.
          channelId: tenantData.broadcasterChannelId || tenantData.botChannelId || data.channelId || '',
          chatroomId: tenantData.broadcasterChatroomId || tenantData.botChatroomId || data.chatroomId || '',
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

      // Persist in the CORRECT file format (broadcasterToken/botToken fields)
      const tokensFile = tenantPath(this.tenantId, 'tokens/kick-tokens.json');
      let existing: Record<string, any> = {};
      try { existing = JSON.parse(await fs.readFile(tokensFile, 'utf-8')); } catch {}
      // Determine which token type this is and update the right fields
      if (existing.botToken && this.tokens.username === (existing.botUsername || '')) {
        existing.botToken = this.tokens.accessToken;
        existing.botRefreshToken = this.tokens.refreshToken;
        existing.botTokenExpiry = this.tokens.tokenExpiry;
      } else {
        existing.broadcasterToken = this.tokens.accessToken;
        existing.broadcasterRefreshToken = this.tokens.refreshToken;
        existing.broadcasterTokenExpiry = this.tokens.tokenExpiry;
      }
      existing.lastUpdated = new Date().toISOString();
      await fs.writeFile(tokensFile, JSON.stringify(existing, null, 2));
      console.log('[Kick] ✅ Token refreshed');
      return true;
    } catch (error) {
      console.error('[Kick] Token refresh error:', error);
      return false;
    }
  }

  /**
   * Refresh the global bot token
   */
  private async refreshBotToken(botData: any): Promise<string | null> {
    const clientId = process.env.KICK_CLIENT_ID;
    const clientSecret = process.env.KICK_CLIENT_SECRET;
    if (!clientId || !clientSecret || !botData.refreshToken) return null;

    try {
      const res = await fetch('https://id.kick.com/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          grant_type: 'refresh_token',
          refresh_token: botData.refreshToken,
        }),
      });
      if (!res.ok) return null;
      const data = await res.json();
      botData.accessToken = data.access_token;
      if (data.refresh_token) botData.refreshToken = data.refresh_token;
      botData.tokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
      // Persist
      const { globalPath: gp } = require('../lib/tenant');
      await fs.writeFile(gp('kick-bot-tokens.json'), JSON.stringify(botData, null, 2));
      console.log('[Kick] ✅ Bot token refreshed');
      return botData.accessToken;
    } catch {
      return null;
    }
  }

  /**
   * Get a valid access token, refreshing if needed (proactively refreshes 5 min before expiry)
   */
  private async getValidToken(): Promise<string | null> {
    if (!this.tokens) return null;
    // Refresh 5 minutes before expiry to never hit an expired token
    const REFRESH_BUFFER_MS = 5 * 60 * 1000;
    if (Date.now() >= (this.tokens.tokenExpiry - REFRESH_BUFFER_MS)) {
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
      this.pusher = new PusherClient('32cbd69e4b950bf97679', {
        cluster: 'us2',
        wsHost: 'ws-us2.pusher.com',
        wsPort: 443,
        wssPort: 443,
        enabledTransports: ['ws', 'wss'],
        forceTLS: true
      });

      this.pusher.connection.bind('connected', () => {
        console.log(`[Kick] ✅ Pusher WebSocket connected (channel: ${channelName}, chatroom: ${this.chatroomId})`);
        this.connected = true;
        this.emit('connected');
      });

      this.pusher.connection.bind('disconnected', () => {
        console.warn(`[Kick] ⚠️ Pusher disconnected for ${channelName}`);
        this.connected = false;
        this.emit('disconnected');
        this.scheduleReconnect();
      });

      this.pusher.connection.bind('error', (err: any) => {
        const details = err?.error?.data || err;
        const code = Number(details?.code || err?.data?.code || 0);
        const message = String(details?.message || err?.data?.message || '');
        if (code === 4200 || /reconnect immediately/i.test(message)) {
          console.log(`[Kick] Pusher requested reconnect for ${channelName}; transport will reconnect.`);
          return;
        }
        console.error(`[Kick] ❌ Pusher connection error for ${channelName}:`, details);
        this.emit('error', err);
      });

      this.pusher.connection.bind('unavailable', () => {
        console.warn(`[Kick] ⚠️ Pusher unavailable for ${channelName}, will retry...`);
        this.connected = false;
        this.scheduleReconnect();
      });

      this.pusher.connection.bind('state_change', (states: any) => {
        console.log(`[Kick] Pusher state: ${states.previous} → ${states.current} (${channelName})`);
      });

      const channelKey = `chatrooms.${this.chatroomId}.v2`;
      this.channel = this.pusher.subscribe(channelKey);

      this.channel.bind('pusher:subscription_succeeded', () => {
        console.log(`[Kick] ✅ Subscribed to ${channelKey}`);
      });

      this.channel.bind('pusher:subscription_error', (err: any) => {
        console.error(`[Kick] ❌ Subscription error for ${channelKey}:`, err);
      });

      this.channel.bind('App\\Events\\ChatMessageEvent', (data: any) => {
        this.messageCount++;
        const message = this.parseMessage(data);
        if (message) {
          if (this.messageCount <= 3 || this.messageCount % 50 === 0) {
            console.log(`[Kick] 💬 #${this.messageCount} ${message.username}: ${message.message.slice(0, 80)}`);
          }
          this.emit('message', message);
        }
      });

      this.channel.bind('App\\Events\\SubscriptionEvent', (data: any) => {
        console.log(`[Kick] 🎉 Subscription event:`, data?.username || data);
        const sub = this.parseSubscription(data);
        if (sub) this.emit('subscription', sub);
      });

      this.channel.bind('App\\Events\\FollowersUpdated', (data: any) => {
        console.log(`[Kick] 👋 Follow event:`, data?.username || data);
        this.emit('follow', { username: data.username, followed: data.followed });
      });

      this.channel.bind('App\\Events\\GiftsLeaderboardUpdated', (data: any) => {
        this.emit('gift', data);
      });

      console.log(`[Kick] Pusher connecting to channel: ${channelName} (chatroom: ${this.chatroomId})...`);
    } catch (error) {
      console.error('[Kick] Connection error:', error);
      this.emit('error', error);
      throw error;
    }
  }

  private async getChannelInfo(channelName: string): Promise<any> {
    // Try /public/v1/channels?slug= first (works for any channel)
    let token: string | null = null;
    try {
      const { globalPath: gp } = require('../lib/tenant');
      const botData = JSON.parse(await fs.readFile(gp('kick-bot-tokens.json'), 'utf-8'));
      token = botData.accessToken;
    } catch {}
    if (!token) token = await this.getValidToken();

    if (token) {
      try {
        const res = await fetch(`https://api.kick.com/public/v1/channels?slug=${encodeURIComponent(channelName)}`, {
          headers: { 'Authorization': `Bearer ${token}` },
        });
        if (res.ok) {
          const data = await res.json();
          const channel = data.data?.[0];
          if (channel?.broadcaster_user_id) {
            // In Kick, broadcaster_user_id works as chatroom ID for Pusher
            console.log(`[Kick] Resolved via channels API: broadcaster_user_id=${channel.broadcaster_user_id} for ${channelName}`);
            return { id: channel.broadcaster_user_id, chatroom: { id: channel.broadcaster_user_id } };
          }
        }
      } catch {}

      // Fallback: /users with no id returns the currently authorized user.
      // Kick's current response is { data: [{ user_id, name, ... }] }.
      try {
        const res = await fetch('https://api.kick.com/public/v1/users', {
          headers: { 'Authorization': `Bearer ${token}` },
        });
        if (res.ok) {
          const data = await res.json();
          const user = Array.isArray(data.data) ? data.data[0] : data.data || data;
          const channelId = user?.user_id || user?.id;
          const chatroomId = user?.chatroom_id || user?.chatroom?.id || channelId;
          if (channelId && chatroomId) return { id: channelId, chatroom: { id: chatroomId } };
        }
      } catch {}
    }

    return null;
  }

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
    } catch {
      return null;
    }
  }

  private parseSubscription(data: any): KickSubscription | null {
    try {
      return { username: data.username, months: data.months || 1, tier: data.tier || 1 };
    } catch {
      return null;
    }
  }

  /**
   * Resolve the broadcaster_user_id from Kick's channels API.
   * IMPORTANT: broadcaster_user_id != channelId. The channels API returns the correct value.
   */
  private async getBroadcasterUserId(): Promise<number | null> {
    if (this.broadcasterUserId) return this.broadcasterUserId;

    // Look up via slug (channelName)
    if (this.channelName) {
      try {
        let token: string | null = null;
        // Try bot token first
        try {
          const { globalPath: gp } = require('../lib/tenant');
          const botData = JSON.parse(await fs.readFile(gp('kick-bot-tokens.json'), 'utf-8'));
          token = botData.accessToken;
        } catch {}
        if (!token) token = await this.getValidToken();
        if (!token) return null;

        const res = await fetch(`https://api.kick.com/public/v1/channels?slug=${encodeURIComponent(this.channelName)}`, {
          headers: { 'Authorization': `Bearer ${token}` },
        });
        if (res.ok) {
          const data = await res.json();
          const channel = data.data?.[0];
          if (channel?.broadcaster_user_id) {
            this.broadcasterUserId = channel.broadcaster_user_id;
            console.log(`[Kick] Resolved broadcaster_user_id: ${this.broadcasterUserId} for ${this.channelName}`);
            return this.broadcasterUserId;
          }
        }
      } catch (e: any) {
        console.warn('[Kick] Failed to resolve broadcaster_user_id:', e.message);
      }
    }
    return null;
  }

  /**
   * Send a message to Kick chat.
   * Uses global bot token with type:'user' + broadcaster_user_id (proven working).
   * Falls back to tenant broadcaster token if bot token unavailable.
   */
  async sendChatMessage(message: string): Promise<void> {
    if (!this.connected) {
      throw new Error('Not connected to Kick');
    }

    // Resolve broadcaster_user_id from Kick API (channelId stored in tokens is NOT the same)
    const broadcasterId = await this.getBroadcasterUserId();
    if (!broadcasterId) {
      throw new Error('Kick broadcaster identity is unavailable');
    }

    // 1. Try global bot token (sends as streamweaverbot)
    let sent = false;
    try {
      const { globalPath: gp } = require('../lib/tenant');
      const globalFile = gp('kick-bot-tokens.json');
      const botData = JSON.parse(await fs.readFile(globalFile, 'utf-8'));
      let botToken = botData.accessToken;

      // Refresh if expired
      if (Date.now() >= (botData.tokenExpiry || 0)) {
        botToken = await this.refreshBotToken(botData);
      }

      if (botToken) {
        const res = await fetch('https://api.kick.com/public/v1/chat', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${botToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: message, type: 'user', broadcaster_user_id: broadcasterId }),
        });
        if (res.ok) {
          console.log('[Kick] ✅ Message sent (bot token)');
          sent = true;
        } else {
          const errText = await res.text();
          console.warn(`[Kick] Bot token send failed (${res.status}):`, errText);
          // If 401, try refreshing
          if (res.status === 401) {
            const newToken = await this.refreshBotToken(botData);
            if (newToken) {
              const retry = await fetch('https://api.kick.com/public/v1/chat', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${newToken}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ content: message, type: 'user', broadcaster_user_id: broadcasterId }),
              });
              if (retry.ok) { console.log('[Kick] ✅ Message sent (bot token retry)'); sent = true; }
            }
          }
        }
      }
    } catch (e: any) {
      console.warn('[Kick] Bot token unavailable:', e.message);
    }

    if (sent) return;

    // 2. Fallback: broadcaster token
    const token = await this.getValidToken();
    if (!token) {
      throw new Error('Kick outbound token is unavailable');
    }

    const res = await fetch('https://api.kick.com/public/v1/chat', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: message, type: 'user', broadcaster_user_id: broadcasterId }),
    });

    if (res.ok) {
      console.log('[Kick] ✅ Message sent (broadcaster token)');
      return;
    } else {
      const errText = await res.text();
      console.error(`[Kick] Send failed (${res.status}):`, errText);
      if (res.status === 401) {
        const refreshed = await this.refreshAccessToken();
        if (refreshed) {
          const retry = await fetch('https://api.kick.com/public/v1/chat', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${this.tokens!.accessToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: message, type: 'user', broadcaster_user_id: broadcasterId }),
          });
          if (retry.ok) {
            console.log('[Kick] ✅ Message sent on retry');
            return;
          }
          console.error('[Kick] Retry failed:', retry.status);
        }
      }
    }
    throw new Error(`Kick rejected the outbound message (${res.status})`);
  }

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

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    const channelName = this.channelName;
    const tenantId = this.tenantId;
    if (!channelName) return;

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      if (this.connected) return;
      console.log(`[Kick] 🔄 Attempting reconnect for ${channelName}...`);
      try {
        this.cleanupPusher();
        await this.connect(channelName, tenantId || undefined);
      } catch (e) {
        console.error(`[Kick] ❌ Reconnect failed for ${channelName}:`, e);
        this.scheduleReconnect();
      }
    }, 15000);
  }

  private cleanupPusher() {
    try {
      if (this.channel) { this.channel.unbind_all(); this.pusher?.unsubscribe(this.channel.name); }
      if (this.pusher) this.pusher.disconnect();
    } catch {}
    this.channel = null;
    this.pusher = null;
  }

  disconnect() {
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    this.cleanupPusher();
    this.connected = false;
    this.channelName = null;
    this.channelId = null;
    this.chatroomId = null;
    this.tokens = null;
    this.tenantId = null;
    this.messageCount = 0;
    console.log('[Kick] Disconnected');
    this.emit('disconnected');
  }

  isConnected(): boolean { return this.connected; }
  hasAuth(): boolean { return this.tokens !== null; }
  getChannelName(): string | null { return this.channelName; }
  getTenantId(): string | null { return this.tenantId; }
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
