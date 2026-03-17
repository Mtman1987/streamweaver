/**
 * Multi-Platform Chat Manager
 * Handles chat connections for Twitch, YouTube, Kick, TikTok, and Discord
 */

import { EventEmitter } from 'events';
import { getYouTubeService, YouTubeMessage } from './youtube';
import { getKickService, KickMessage } from './kick';
import { getTikTokService, TikTokMessage, TikTokGift, TikTokFollow } from './tiktok';

export interface UnifiedMessage {
  platform: 'twitch' | 'youtube' | 'kick' | 'tiktok' | 'discord';
  id: string;
  username: string;
  displayName: string;
  message: string;
  timestamp: Date;
  badges?: string[];
  isSubscriber?: boolean;
  isModerator?: boolean;
  color?: string;
  emotes?: any;
}

export interface UnifiedEvent {
  platform: 'twitch' | 'youtube' | 'kick' | 'tiktok';
  type: 'follow' | 'subscription' | 'gift' | 'raid' | 'host' | 'share' | 'like';
  data: any;
  timestamp: Date;
}

export class MultiPlatformChatManager extends EventEmitter {
  private connections: Map<string, boolean> = new Map();
  
  constructor() {
    super();
    this.on('error', (payload) => {
      console.error('[MultiPlatform] Event error:', payload);
    });
  }

  /**
   * Connect to YouTube Live Chat
   */
  async connectYouTube(accessToken: string, refreshToken?: string): Promise<void> {
    try {
      const youtube = getYouTubeService();
      
      youtube.setAccessToken(accessToken, refreshToken);

      youtube.on('message', (msg: YouTubeMessage) => {
        const unified: UnifiedMessage = {
          platform: 'youtube',
          id: msg.id,
          username: msg.authorChannelId,
          displayName: msg.authorDisplayName,
          message: msg.message,
          timestamp: msg.timestamp,
          isSubscriber: msg.isMembership,
          badges: msg.isSuperChat ? ['super_chat'] : msg.isMembership ? ['member'] : []
        };

        this.emit('message', unified);

        // Emit special events for super chats
        if (msg.isSuperChat) {
          this.emit('event', {
            platform: 'youtube',
            type: 'gift',
            data: {
              username: msg.authorDisplayName,
              amount: msg.superChatAmount,
              message: msg.message
            },
            timestamp: msg.timestamp
          } as UnifiedEvent);
        }
      });

      youtube.on('connected', () => {
        this.connections.set('youtube', true);
        console.log('[MultiPlatform] YouTube connected');
        this.emit('platformConnected', 'youtube');
      });

      youtube.on('disconnected', () => {
        this.connections.set('youtube', false);
        this.emit('platformDisconnected', 'youtube');
      });

      youtube.on('error', (error) => {
        this.emit('error', { platform: 'youtube', error });
      });

      await youtube.connectToLiveChat();

    } catch (error) {
      console.error('[MultiPlatform] YouTube connection error:', error);
      throw error;
    }
  }

  /**
   * Connect to Kick Chat
   */
  async connectKick(channelName: string): Promise<void> {
    try {
      const kick = getKickService();

      kick.on('message', (msg: KickMessage) => {
        const unified: UnifiedMessage = {
          platform: 'kick',
          id: msg.id,
          username: msg.username,
          displayName: msg.displayName,
          message: msg.message,
          timestamp: msg.timestamp,
          badges: msg.badges,
          isSubscriber: msg.isSubscriber,
          isModerator: msg.isModerator
        };

        this.emit('message', unified);
      });

      kick.on('subscription', (sub) => {
        this.emit('event', {
          platform: 'kick',
          type: 'subscription',
          data: sub,
          timestamp: new Date()
        } as UnifiedEvent);
      });

      kick.on('follow', (follow) => {
        this.emit('event', {
          platform: 'kick',
          type: 'follow',
          data: follow,
          timestamp: new Date()
        } as UnifiedEvent);
      });

      kick.on('gift', (gift) => {
        this.emit('event', {
          platform: 'kick',
          type: 'gift',
          data: gift,
          timestamp: new Date()
        } as UnifiedEvent);
      });

      kick.on('connected', () => {
        this.connections.set('kick', true);
        console.log('[MultiPlatform] Kick connected');
        this.emit('platformConnected', 'kick');
      });

      kick.on('disconnected', () => {
        this.connections.set('kick', false);
        this.emit('platformDisconnected', 'kick');
      });

      kick.on('error', (error) => {
        this.emit('error', { platform: 'kick', error });
      });

      await kick.connect(channelName);

    } catch (error) {
      console.error('[MultiPlatform] Kick connection error:', error);
      throw error;
    }
  }

  /**
   * Connect to TikTok Live
   */
  async connectTikTok(username: string): Promise<void> {
    try {
      const tiktok = getTikTokService();

      tiktok.on('message', (msg: TikTokMessage) => {
        const unified: UnifiedMessage = {
          platform: 'tiktok',
          id: msg.id,
          username: msg.username,
          displayName: msg.displayName,
          message: msg.message,
          timestamp: msg.timestamp
        };

        this.emit('message', unified);
      });

      tiktok.on('gift', (gift: TikTokGift) => {
        this.emit('event', {
          platform: 'tiktok',
          type: 'gift',
          data: gift,
          timestamp: new Date()
        } as UnifiedEvent);
      });

      tiktok.on('follow', (follow: TikTokFollow) => {
        this.emit('event', {
          platform: 'tiktok',
          type: 'follow',
          data: follow,
          timestamp: new Date()
        } as UnifiedEvent);
      });

      tiktok.on('share', (share) => {
        this.emit('event', {
          platform: 'tiktok',
          type: 'share',
          data: share,
          timestamp: new Date()
        } as UnifiedEvent);
      });

      tiktok.on('like', (like) => {
        this.emit('event', {
          platform: 'tiktok',
          type: 'like',
          data: like,
          timestamp: new Date()
        } as UnifiedEvent);
      });

      tiktok.on('connected', () => {
        this.connections.set('tiktok', true);
        console.log('[MultiPlatform] TikTok connected');
        this.emit('platformConnected', 'tiktok');
      });

      tiktok.on('disconnected', () => {
        this.connections.set('tiktok', false);
        this.emit('platformDisconnected', 'tiktok');
      });

      tiktok.on('error', (error) => {
        this.emit('error', { platform: 'tiktok', error });
      });

      await tiktok.connect(username);

    } catch (error) {
      console.error('[MultiPlatform] TikTok connection error:', error);
      throw error;
    }
  }

  /**
   * Send message to specific platform
   */
  async sendMessage(platform: 'youtube' | 'kick', message: string): Promise<void> {
    switch (platform) {
      case 'youtube':
        await getYouTubeService().sendChatMessage(message);
        break;
      case 'kick':
        await getKickService().sendChatMessage(message);
        break;
      default:
        throw new Error(`Sending messages not supported for ${platform}`);
    }
  }

  /**
   * Get connection status for all platforms
   */
  getStatus(): Record<string, boolean> {
    return {
      youtube: this.connections.get('youtube') || false,
      kick: this.connections.get('kick') || false,
      tiktok: this.connections.get('tiktok') || false
    };
  }

  /**
   * Disconnect from specific platform
   */
  disconnect(platform: 'youtube' | 'kick' | 'tiktok') {
    switch (platform) {
      case 'youtube':
        getYouTubeService().disconnect();
        break;
      case 'kick':
        getKickService().disconnect();
        break;
      case 'tiktok':
        getTikTokService().disconnect();
        break;
    }
    this.connections.set(platform, false);
  }

  /**
   * Disconnect from all platforms
   */
  disconnectAll() {
    getYouTubeService().disconnect();
    getKickService().disconnect();
    getTikTokService().disconnect();
    this.connections.clear();
    console.log('[MultiPlatform] All platforms disconnected');
  }
}

// Singleton instance
let multiPlatformManager: MultiPlatformChatManager | null = null;

export function getMultiPlatformManager(): MultiPlatformChatManager {
  if (!multiPlatformManager) {
    multiPlatformManager = new MultiPlatformChatManager();
  }
  return multiPlatformManager;
}
