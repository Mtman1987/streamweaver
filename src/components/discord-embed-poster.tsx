'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';

export function DiscordEmbedPoster() {
  const [channelId, setChannelId] = useState('');
  const [isPosting, setIsPosting] = useState(false);
  const { toast } = useToast();

  const gameUrl = typeof window !== 'undefined' ? `${window.location.origin}/games` : '';

  const postEmbed = async () => {
    if (!channelId.trim()) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Please enter a Discord channel ID'
      });
      return;
    }

    setIsPosting(true);
    try {
      const response = await fetch('/api/discord/post-embed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channelId: channelId.trim(),
          embed: {
            title: '🎮 StreamWeaver Community Games',
            description: 'Join the fun! Play Stream Bingo and Tag Game with the community.',
            url: gameUrl,
            color: 0x9146FF, // Twitch purple
            fields: [
              {
                name: '🎯 Stream Bingo',
                value: 'Play bingo while watching streams! Mark squares when you see these moments happen.',
                inline: false
              },
              {
                name: '🏷️ Tag Game', 
                value: 'Tag other community members in chat and compete for points!',
                inline: false
              },
              {
                name: '📺 Live Streams',
                value: 'See who from the community is streaming right now.',
                inline: false
              }
            ],
            footer: {
              text: 'Click the link above to join the games!'
            },
            timestamp: new Date().toISOString()
          }
        })
      });

      if (response.ok) {
        toast({
          title: 'Success!',
          description: 'Game embed posted to Discord channel'
        });
        setChannelId('');
      } else {
        throw new Error('Failed to post embed');
      }
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to post embed to Discord'
      });
    } finally {
      setIsPosting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Share Games to Discord</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="gameUrl">Game URL</Label>
          <Input 
            id="gameUrl"
            value={gameUrl}
            readOnly
            className="bg-muted"
          />
        </div>
        
        <div className="space-y-2">
          <Label htmlFor="channelId">Discord Channel ID</Label>
          <Input
            id="channelId"
            placeholder="Enter Discord channel ID..."
            value={channelId}
            onChange={(e) => setChannelId(e.target.value)}
          />
        </div>
        
        <Button 
          onClick={postEmbed}
          disabled={isPosting}
          className="w-full"
        >
          {isPosting ? 'Posting...' : 'Post Game Embed to Discord'}
        </Button>
      </CardContent>
    </Card>
  );
}