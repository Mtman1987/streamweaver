'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ExternalLink, Users, Eye } from 'lucide-react';

interface LiveMember {
  discordId: string;
  discordUsername: string;
  discordDisplayName: string;
  twitchUsername: string;
  twitchDisplayName: string;
  streamTitle: string;
  gameName: string;
  viewerCount: number;
  thumbnailUrl: string;
}

export function LiveDiscordMembers() {
  const [liveMembers, setLiveMembers] = useState<LiveMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastFetch, setLastFetch] = useState(0);

  const fetchLiveMembers = async () => {
    try {
      setLoading(true);
      console.log('[Live Discord Members] Starting fetch from bot channels');

      // Get channels from bot-channels.json (single source of truth)
      const channelsResponse = await fetch('/api/bot/channels');
      if (!channelsResponse.ok) {
        throw new Error('Failed to fetch bot channels');
      }
      const { channels } = await channelsResponse.json();
      console.log('[Live Discord Members] Got channels:', channels?.length || 0);

      if (!Array.isArray(channels) || channels.length === 0) {
        console.warn('[Live Discord Members] No channels to check');
        setLiveMembers([]);
        setError(null);
        return;
      }

      const usernames = channels.map((c: any) => c.name);
      console.log(`[Live Discord Members] Checking ${usernames.length} channels for live status`);

      // Check who's live on Twitch
      const liveResponse = await fetch('/api/twitch/live', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ usernames })
      });
      
      if (!liveResponse.ok) {
        throw new Error('Failed to check live status');
      }
      const { liveUsers } = await liveResponse.json();
      console.log('[Live Discord Members] Live users found:', liveUsers?.length || 0);

      const liveMembersList: LiveMember[] = liveUsers.map((stream: any) => ({
        discordId: stream.username,
        discordUsername: stream.username,
        discordDisplayName: stream.displayName || stream.username,
        twitchUsername: stream.username,
        twitchDisplayName: stream.displayName,
        streamTitle: stream.title,
        gameName: stream.gameName,
        viewerCount: stream.viewerCount,
        thumbnailUrl: stream.thumbnailUrl,
      }));

      console.log('[Live Discord Members] Final data:', liveMembersList.length, 'live members');
      setLiveMembers(liveMembersList);
      setError(null);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      console.error('[Live Discord Members] Error:', errorMsg);
      setError(errorMsg);
    } finally {
      setLoading(false);
      console.log('[Live Discord Members] Fetch complete');
    }
  };

  useEffect(() => {
    fetchLiveMembers();
    const interval = setInterval(fetchLiveMembers, 30000);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Live Discord Members
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-4">Loading...</div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Live Discord Members
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-4 text-red-500">
            Error: {error}
            <Button variant="outline" size="sm" onClick={fetchLiveMembers} className="ml-2">
              Retry
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="h-5 w-5" />
          Live Discord Members ({liveMembers.length})
        </CardTitle>
      </CardHeader>
      <CardContent>
        {liveMembers.length === 0 ? (
          <div className="text-center py-4 text-muted-foreground">
            No Discord members are currently live on Twitch
          </div>
        ) : (
          <div className="space-y-4">
            {liveMembers.map((member) => (
              <div key={member.discordId} className="border rounded-lg p-4 border-green-500/20">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <h4 className="font-semibold">
                        {member.discordDisplayName || member.discordUsername}
                      </h4>
                      <Badge variant="secondary">
                        @{member.twitchUsername}
                      </Badge>
                      <Badge className="bg-red-500 text-white">LIVE</Badge>
                    </div>
                    
                    <p className="text-sm text-muted-foreground mb-2">
                      {member.streamTitle}
                    </p>
                    
                    <div className="flex items-center gap-4 text-sm">
                      <div className="flex items-center gap-1">
                        <Eye className="h-4 w-4" />
                        {member.viewerCount?.toLocaleString()} viewers
                      </div>
                      {member.gameName && (
                        <Badge variant="outline">
                          {member.gameName}
                        </Badge>
                      )}
                    </div>
                  </div>
                  
                  <Button variant="outline" size="sm" asChild>
                    <a
                      href={`https://twitch.tv/${member.twitchUsername}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1"
                    >
                      <ExternalLink className="h-4 w-4" />
                      Watch
                    </a>
                  </Button>
                </div>
                
                {member.thumbnailUrl && (
                  <div className="mt-3">
                    <img
                      src={member.thumbnailUrl.replace('{width}', '320').replace('{height}', '180')}
                      alt={`Stream preview for ${member.twitchUsername}`}
                      className="w-full max-w-xs rounded border object-cover aspect-video"
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        
        <div className="mt-4 pt-4 border-t">
          <Button variant="ghost" size="sm" onClick={fetchLiveMembers} disabled={loading}>
            Refresh
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}