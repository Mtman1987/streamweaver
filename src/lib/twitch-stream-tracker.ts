export class TwitchStreamTracker {
  private static instance: TwitchStreamTracker;
  
  static getInstance(): TwitchStreamTracker {
    if (!TwitchStreamTracker.instance) {
      TwitchStreamTracker.instance = new TwitchStreamTracker();
    }
    return TwitchStreamTracker.instance;
  }

  async getTwitchStreamData(userId: string): Promise<any> {
    try {
      const response = await fetch(`https://api.twitch.tv/helix/streams?user_id=${userId}`, {
        headers: {
          'Client-ID': process.env.TWITCH_CLIENT_ID!,
          'Authorization': `Bearer ${process.env.TWITCH_USER_OAUTH_TOKEN}`
        }
      });

      if (!response.ok) return null;

      const data = await response.json();
      return data.data[0] || null;
    } catch (error) {
      console.error('Error fetching Twitch stream data:', error);
      return null;
    }
  }
}