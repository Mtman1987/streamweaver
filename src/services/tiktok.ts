/**
 * TikTok Live Integration Service
 * Handles TikTok Live events using TikTokLiveSharp or WebCast API
 */

import { EventEmitter } from 'events';
import { WebcastPushConnection } from 'tiktok-live-connector';

export interface TikTokMessage {
  id: string;
  username: string;
  displayName: string;
  message: string;
  timestamp: Date;
  profilePicture?: string;
}

export interface TikTokGift {
  username: string;
  giftName: string;
  giftId: number;
  repeatCount: number;
  diamondCost: number;
}

export interface TikTokShare {
  username: string;
  displayName: string;
}

export interface TikTokFollow {
  username: string;
  displayName: string;
}

export interface TikTokLike {
  username: string;
  likeCount: number;
  totalLikes: number;
}

export class TikTokService extends EventEmitter {
  private connection: any;
  private username: string | null = null;
  private connected: boolean = false;

  constructor() {
    super();
  }

  /**
   * Connect to TikTok Live stream
   */
  async connect(username: string): Promise<void> {
    try {
      this.username = username;

      // Create connection to TikTok Live
      this.connection = new WebcastPushConnection(username, {
        processInitialData: true,
        enableExtendedGiftInfo: true,
        enableWebsocketUpgrade: true,
        requestPollingIntervalMs: 1000
      });

      // Chat messages
      this.connection.on('chat', (data: any) => {
        const message: TikTokMessage = {
          id: data.msgId || Date.now().toString(),
          username: data.uniqueId,
          displayName: data.nickname,
          message: data.comment,
          timestamp: new Date(),
          profilePicture: data.profilePictureUrl
        };
        this.emit('message', message);
      });

      // Gifts (donations)
      this.connection.on('gift', (data: any) => {
        // Only emit when gift streaks are complete
        if (data.giftType === 1 && data.repeatEnd) {
          const gift: TikTokGift = {
            username: data.uniqueId,
            giftName: data.giftName,
            giftId: data.giftId,
            repeatCount: data.repeatCount,
            diamondCost: data.diamondCount
          };
          this.emit('gift', gift);
        }
      });

      // Follows
      this.connection.on('follow', (data: any) => {
        const follow: TikTokFollow = {
          username: data.uniqueId,
          displayName: data.nickname
        };
        this.emit('follow', follow);
      });

      // Shares
      this.connection.on('share', (data: any) => {
        const share: TikTokShare = {
          username: data.uniqueId,
          displayName: data.nickname
        };
        this.emit('share', share);
      });

      // Likes
      this.connection.on('like', (data: any) => {
        const like: TikTokLike = {
          username: data.uniqueId,
          likeCount: data.likeCount,
          totalLikes: data.totalLikeCount
        };
        this.emit('like', like);
      });

      // View count updates
      this.connection.on('roomUser', (data: any) => {
        this.emit('viewerCount', {
          viewerCount: data.viewerCount
        });
      });

      // Connection state
      this.connection.on('connected', () => {
        this.connected = true;
        console.log(`[TikTok] Connected to @${username}'s live stream`);
        this.emit('connected');
      });

      this.connection.on('disconnected', () => {
        this.connected = false;
        console.log('[TikTok] Disconnected from live stream');
        this.emit('disconnected');
      });

      this.connection.on('error', (error: Error) => {
        console.error('[TikTok] Connection error:', error);
        this.emit('error', error);
      });

      // Start connection
      await this.connection.connect();

    } catch (error) {
      console.error('[TikTok] Error connecting:', error);
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Get viewer statistics
   */
  getStatistics(): any {
    if (!this.connection) {
      return null;
    }

    return {
      connected: this.connected,
      viewerCount: this.connection.getState()?.viewerCount || 0,
      likeCount: this.connection.getState()?.likeCount || 0
    };
  }

  /**
   * Disconnect from TikTok Live
   */
  disconnect() {
    if (this.connection) {
      this.connection.disconnect();
      this.connection = null;
    }

    this.connected = false;
    this.username = null;
    console.log('[TikTok] Disconnected');
    this.emit('disconnected');
  }

  /**
   * Get connection status
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Note: TikTok does not provide a public API for sending messages
   * This is read-only integration for receiving live events
   */
}

// Singleton instance
let tiktokService: TikTokService | null = null;

export function getTikTokService(): TikTokService {
  if (!tiktokService) {
    tiktokService = new TikTokService();
  }
  return tiktokService;
}
