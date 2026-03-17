/**
 * Kick.com Chat Integration Service
 * Handles Kick API and WebSocket connections for live streaming
 */

import WebSocket from 'ws';
import { EventEmitter } from 'events';
import Pusher from 'pusher-js';

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

export class KickService extends EventEmitter {
  private pusher: any;
  private channel: any;
  private channelName: string | null = null;
  private channelId: number | null = null;
  private connected: boolean = false;

  constructor() {
    super();
  }

  /**
   * Connect to Kick channel chat
   */
  async connect(channelName: string): Promise<void> {
    try {
      this.channelName = channelName;

      // Get channel info from Kick API
      const channelInfo = await this.getChannelInfo(channelName);
      if (!channelInfo) {
        throw new Error('Channel not found');
      }

      this.channelId = channelInfo.id;
      const chatroomId = channelInfo.chatroom?.id;

      if (!chatroomId) {
        throw new Error('Chatroom not found');
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

      // Subscribe to chatroom channel
      const channelKey = `chatrooms.${chatroomId}.v2`;
      this.channel = this.pusher.subscribe(channelKey);

      // Listen for chat messages
      this.channel.bind('App\\Events\\ChatMessageEvent', (data: any) => {
        const message = this.parseMessage(data);
        if (message) {
          this.emit('message', message);
        }
      });

      // Listen for subscriptions
      this.channel.bind('App\\Events\\SubscriptionEvent', (data: any) => {
        const sub = this.parseSubscription(data);
        if (sub) {
          this.emit('subscription', sub);
        }
      });

      // Listen for follows
      this.channel.bind('App\\Events\\FollowersUpdated', (data: any) => {
        this.emit('follow', {
          username: data.username,
          followed: data.followed
        });
      });

      // Listen for gifts/tips
      this.channel.bind('App\\Events\\GiftsLeaderboardUpdated', (data: any) => {
        this.emit('gift', data);
      });

      this.connected = true;
      console.log(`[Kick] Connected to channel: ${channelName}`);
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
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
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
      const badges = [];

      if (sender.identity?.badges) {
        for (const badge of sender.identity.badges) {
          badges.push(badge.type);
        }
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
      return {
        username: data.username,
        months: data.months || 1,
        tier: data.tier || 1
      };
    } catch (error) {
      console.error('[Kick] Error parsing subscription:', error);
      return null;
    }
  }

  /**
   * Send a message to Kick chat
   * Note: Requires authentication - this is a placeholder
   */
  async sendChatMessage(message: string): Promise<void> {
    if (!this.connected || !this.channelId) {
      throw new Error('Not connected to Kick');
    }

    try {
      // Note: Kick API for sending messages requires authentication
      // This would need a proper auth token and API endpoint
      console.log('[Kick] Sending message (requires auth):', message);
      
      // Placeholder - actual implementation would need:
      // - Valid auth token
      // - POST to https://kick.com/api/v2/messages/send/{chatroomId}
      // - Headers with Bearer token
      
      throw new Error('Kick message sending requires authentication token');
    } catch (error) {
      console.error('[Kick] Error sending message:', error);
      throw error;
    }
  }

  /**
   * Delete a message (moderator action)
   */
  async deleteMessage(messageId: string): Promise<void> {
    if (!this.connected) {
      throw new Error('Not connected to Kick');
    }

    try {
      console.log('[Kick] Deleting message (requires mod auth):', messageId);
      // Requires moderator auth token
      throw new Error('Kick message deletion requires moderator authentication');
    } catch (error) {
      console.error('[Kick] Error deleting message:', error);
      throw error;
    }
  }

  /**
   * Ban a user from chat
   */
  async banUser(username: string, permanent: boolean = false): Promise<void> {
    if (!this.connected) {
      throw new Error('Not connected to Kick');
    }

    try {
      console.log(`[Kick] ${permanent ? 'Banning' : 'Timing out'} user (requires mod auth):`, username);
      // Requires moderator auth token
      throw new Error('Kick user moderation requires moderator authentication');
    } catch (error) {
      console.error('[Kick] Error banning user:', error);
      throw error;
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

    if (this.pusher) {
      this.pusher.disconnect();
    }

    this.connected = false;
    this.channelName = null;
    this.channelId = null;
    console.log('[Kick] Disconnected');
    this.emit('disconnected');
  }

  /**
   * Get connection status
   */
  isConnected(): boolean {
    return this.connected;
  }
}

// Singleton instance
let kickService: KickService | null = null;

export function getKickService(): KickService {
  if (!kickService) {
    kickService = new KickService();
  }
  return kickService;
}
