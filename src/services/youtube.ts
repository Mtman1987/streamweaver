/**
 * YouTube Live Chat Integration Service
 * Handles YouTube API interactions for live streaming
 */

import { google, youtube_v3 } from 'googleapis';
import { EventEmitter } from 'events';

export interface YouTubeMessage {
  id: string;
  authorChannelId: string;
  authorDisplayName: string;
  message: string;
  timestamp: Date;
  isSuperChat: boolean;
  superChatAmount?: number;
  isMembership: boolean;
  membershipLevel?: string;
}

export class YouTubeService extends EventEmitter {
  private youtube: youtube_v3.Youtube;
  private oauth2Client: any;
  private liveChatId: string | null = null;
  private pollInterval: NodeJS.Timeout | null = null;
  private nextPageToken: string | undefined;

  constructor() {
    super();
    
    const clientId = process.env.YOUTUBE_CLIENT_ID;
    const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;
    const redirectUri = process.env.YOUTUBE_REDIRECT_URI || 'http://localhost:3100/auth/youtube/callback';

    if (!clientId || !clientSecret) {
      console.warn('[YouTube] Client ID or Secret not configured');
    }

    this.oauth2Client = new google.auth.OAuth2(
      clientId,
      clientSecret,
      redirectUri
    );

    this.youtube = google.youtube({
      version: 'v3',
      auth: this.oauth2Client
    });
  }

  /**
   * Set access token for authenticated requests
   */
  setAccessToken(accessToken: string, refreshToken?: string) {
    this.oauth2Client.setCredentials({
      access_token: accessToken,
      refresh_token: refreshToken
    });
  }

  /**
   * Get OAuth URL for user authentication
   */
  getAuthUrl(): string {
    const scopes = [
      'https://www.googleapis.com/auth/youtube.readonly',
      'https://www.googleapis.com/auth/youtube',
      'https://www.googleapis.com/auth/youtube.force-ssl'
    ];

    return this.oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: scopes,
      prompt: 'consent'
    });
  }

  /**
   * Exchange authorization code for tokens
   */
  async getTokensFromCode(code: string): Promise<{ access_token: string; refresh_token?: string }> {
    const { tokens } = await this.oauth2Client.getToken(code);
    this.oauth2Client.setCredentials(tokens);
    return tokens;
  }

  /**
   * Find the active live broadcast and get its chat ID
   */
  async connectToLiveChat(): Promise<void> {
    try {
      const response = await this.youtube.liveBroadcasts.list({
        part: ['snippet'],
        broadcastStatus: 'active',
        broadcastType: 'all'
      });

      if (response.data.items && response.data.items.length > 0) {
        const broadcast = response.data.items[0];
        this.liveChatId = broadcast.snippet?.liveChatId || null;

        if (this.liveChatId) {
          console.log('[YouTube] Connected to live chat:', this.liveChatId);
          this.startPolling();
          this.emit('connected');
        } else {
          console.error('[YouTube] No live chat ID found');
          this.emit('error', new Error('No live chat ID found'));
        }
      } else {
        console.log('[YouTube] No active broadcast found');
        this.emit('error', new Error('No active broadcast'));
      }
    } catch (error) {
      console.error('[YouTube] Error connecting to live chat:', error);
      this.emit('error', error);
    }
  }

  /**
   * Start polling for new chat messages
   */
  private startPolling() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
    }

    // Initial poll
    this.pollMessages();

    // Poll every 2 seconds (YouTube rate limit)
    this.pollInterval = setInterval(() => {
      this.pollMessages();
    }, 2000);
  }

  /**
   * Poll for new chat messages
   */
  private async pollMessages() {
    if (!this.liveChatId) return;

    try {
      const response = await this.youtube.liveChatMessages.list({
        liveChatId: this.liveChatId,
        part: ['snippet', 'authorDetails'],
        pageToken: this.nextPageToken
      });

      this.nextPageToken = response.data.nextPageToken || undefined;

      if (response.data.items) {
        for (const item of response.data.items) {
          const message = this.parseMessage(item);
          if (message) {
            this.emit('message', message);
          }
        }
      }
    } catch (error) {
      console.error('[YouTube] Error polling messages:', error);
      this.emit('error', error);
    }
  }

  /**
   * Parse YouTube API message into our format
   */
  private parseMessage(item: youtube_v3.Schema$LiveChatMessage): YouTubeMessage | null {
    if (!item.snippet || !item.authorDetails) return null;

    const snippet = item.snippet;
    const author = item.authorDetails;

    return {
      id: item.id || '',
      authorChannelId: author.channelId || '',
      authorDisplayName: author.displayName || 'Unknown',
      message: snippet.displayMessage || '',
      timestamp: new Date(snippet.publishedAt || Date.now()),
      isSuperChat: snippet.type === 'superChatEvent',
      superChatAmount: snippet.superChatDetails?.amountMicros
        ? Number(snippet.superChatDetails.amountMicros) / 1_000_000
        : undefined,
      isMembership: snippet.type === 'newSponsorEvent',
      membershipLevel: snippet.type === 'newSponsorEvent' ? 
        (snippet as any).memberMilestoneChatDetails?.memberLevel : undefined
    };
  }

  /**
   * Send a message to YouTube live chat
   */
  async sendChatMessage(message: string): Promise<void> {
    if (!this.liveChatId) {
      throw new Error('Not connected to live chat');
    }

    try {
      await this.youtube.liveChatMessages.insert({
        part: ['snippet'],
        requestBody: {
          snippet: {
            liveChatId: this.liveChatId,
            type: 'textMessageEvent',
            textMessageDetails: {
              messageText: message
            }
          }
        }
      });

      console.log('[YouTube] Message sent:', message);
    } catch (error) {
      console.error('[YouTube] Error sending message:', error);
      throw error;
    }
  }

  /**
   * Delete a chat message (moderator action)
   */
  async deleteChatMessage(messageId: string): Promise<void> {
    try {
      await this.youtube.liveChatMessages.delete({
        id: messageId
      });

      console.log('[YouTube] Message deleted:', messageId);
    } catch (error) {
      console.error('[YouTube] Error deleting message:', error);
      throw error;
    }
  }

  /**
   * Ban a user from chat
   */
  async banUser(channelId: string, permanent: boolean = false): Promise<void> {
    if (!this.liveChatId) {
      throw new Error('Not connected to live chat');
    }

    try {
      await this.youtube.liveChatBans.insert({
        part: ['snippet'],
        requestBody: {
          snippet: {
            liveChatId: this.liveChatId,
            type: permanent ? 'permanent' : 'temporary',
            bannedUserDetails: {
              channelId: channelId
            },
            banDurationSeconds: permanent ? undefined : '300' // 5 minutes default
          }
        }
      });

      console.log('[YouTube] User banned:', channelId);
    } catch (error) {
      console.error('[YouTube] Error banning user:', error);
      throw error;
    }
  }

  /**
   * Disconnect from YouTube live chat
   */
  disconnect() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }

    this.liveChatId = null;
    this.nextPageToken = undefined;
    console.log('[YouTube] Disconnected from live chat');
    this.emit('disconnected');
  }
}

// Singleton instance
let youtubeService: YouTubeService | null = null;

export function getYouTubeService(): YouTubeService {
  if (!youtubeService) {
    youtubeService = new YouTubeService();
  }
  return youtubeService;
}
