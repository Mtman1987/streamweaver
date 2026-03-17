'use client';

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';

interface LiveStreamer {
  id: string;
  username: string;
  avatar?: string;
  isActive: boolean;
}

interface LiveStreamersContextType {
  liveStreamers: LiveStreamer[];
  allCommunityMembers: LiveStreamer[];
  refreshStreamers: () => Promise<void>;
  isLoading: boolean;
}

const LiveStreamersContext = createContext<LiveStreamersContextType | undefined>(undefined);

export function LiveStreamersProvider({ children }: { children: ReactNode }) {
  const [liveStreamers, setLiveStreamers] = useState<LiveStreamer[]>([]);
  const [allCommunityMembers, setAllCommunityMembers] = useState<LiveStreamer[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchStreamers = useCallback(async () => {
    try {
      const channelsRes = await fetch('/api/bot/channels');
      if (!channelsRes.ok) return;

      const { channels } = await channelsRes.json();
      const channelNames = channels.map((c: any) => c.name);
      
      if (channelNames.length === 0) {
        setLiveStreamers([]);
        setAllCommunityMembers([]);
        return;
      }

      const liveRes = await fetch('/api/twitch/live', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ usernames: channelNames })
      });

      if (liveRes.ok) {
        const { liveUsers, allUsers } = await liveRes.json();
        const safeAllUsers = allUsers || [];
        const safeLiveUsers = liveUsers || [];

        const communityMembers: LiveStreamer[] = channels.map((channel: any) => {
          let twitchUser = safeAllUsers.find((u: any) => u.username.toLowerCase() === channel.name.toLowerCase());
          if (!twitchUser) {
            twitchUser = safeLiveUsers.find((u: any) => u.username.toLowerCase() === channel.name.toLowerCase());
          }
          const isLive = safeLiveUsers.some((s: any) => s.username.toLowerCase() === channel.name.toLowerCase());
          const avatar = channel.avatar || twitchUser?.profile_image_url || `https://ui-avatars.com/api/?name=${channel.name}&background=random`;
          
          return {
            id: channel.name,
            username: twitchUser?.displayName || channel.name,
            avatar,
            isActive: isLive
          };
        });

        setAllCommunityMembers(communityMembers);
        setLiveStreamers(communityMembers.filter(m => m.isActive));
        
        // Bot auto-join disabled (hosted separately)
        // const liveUsernames = safeLiveUsers.map((u: any) => u.username);
        // if (liveUsernames.length > 0) {
        //   fetch('/api/bot/auto-join', {
        //     method: 'POST',
        //     headers: { 'Content-Type': 'application/json' },
        //     body: JSON.stringify({ liveUsernames })
        //   }).catch(() => {});
        // }
      }
    } catch (error) {
      console.error('Failed to fetch streamers:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStreamers();

    // Poll every 2 minutes
    const interval = setInterval(fetchStreamers, 120000);

    return () => clearInterval(interval);
  }, [fetchStreamers]);

  return (
    <LiveStreamersContext.Provider value={{
      liveStreamers,
      allCommunityMembers,
      refreshStreamers: fetchStreamers,
      isLoading
    }}>
      {children}
    </LiveStreamersContext.Provider>
  );
}

export function useLiveStreamers() {
  const context = useContext(LiveStreamersContext);
  if (context === undefined) {
    throw new Error('useLiveStreamers must be used within a LiveStreamersProvider');
  }
  return context;
}