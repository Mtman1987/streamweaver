'use client';

import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { Users, MessageSquare, RefreshCw } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { useState } from 'react';
import { useToast } from '@/hooks/use-toast';
import { useLiveStreamers } from '@/contexts/live-streamers-context';

interface Player {
  id: string;
  username: string;
  avatar: string;
  isActive: boolean;
}

interface CommunityListProps {
  players?: Player[];
}

const TwitchChatEmbed = ({ username }: { username: string }) => {
  const parentDomain = typeof window !== 'undefined' ? window.location.hostname : '';
  const src = `https://www.twitch.tv/embed/${username}/chat?parent=${parentDomain}&darkpopout`;

  return (
    <div className="h-96 w-80">
      <iframe
        src={src}
        height="100%"
        width="100%"
        className="rounded-md border"
        title={`Twitch chat for ${username}`}
      ></iframe>
    </div>
  );
};

export function CommunityList({ players = [] }: CommunityListProps) {
  const [isSyncing, setIsSyncing] = useState(false);
  const { toast } = useToast();
  const { allCommunityMembers, liveStreamers, refreshStreamers, isLoading } = useLiveStreamers();

  // Use shared data or fallback to props/mock
  const mockPlayers: Player[] = [
    { id: '1', username: 'mtman1987', avatar: 'https://picsum.photos/40/40?1', isActive: true },
    { id: '2', username: 'athenabot87', avatar: 'https://picsum.photos/40/40?2', isActive: false },
    { id: '3', username: 'viewer123', avatar: 'https://picsum.photos/40/40?3', isActive: false },
  ];

  const communityPlayers = allCommunityMembers.length > 0 ? allCommunityMembers : (players.length > 0 ? players : mockPlayers);
  const liveStreamersData = communityPlayers.filter((p) => p.isActive).sort((a, b) => a.username.localeCompare(b.username));
  const offlinePlayers = communityPlayers.filter((p) => !p.isActive).sort((a, b) => a.username.localeCompare(b.username));

  const handleSync = async () => {
    setIsSyncing(true);
    toast({
      title: "Refreshing community...",
      description: "Fetching the latest live status.",
    });

    try {
      await refreshStreamers();
      
      toast({
        title: "List Refreshed!",
        description: "Successfully synchronized players.",
      });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Sync Failed",
        description: "Could not sync community data.",
      });
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <Card className="bg-card/80 backdrop-blur-sm">
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Users className="w-6 h-6 text-primary" />
          <CardTitle className="font-headline">Community ({communityPlayers.length})</CardTitle>
        </div>
        <Button onClick={handleSync} disabled={isSyncing} size="sm" variant="ghost">
          <RefreshCw className={`mr-2 h-4 w-4 ${isSyncing ? 'animate-spin' : ''}`} />
          {isSyncing ? 'Refreshing...' : 'Refresh'}
        </Button>
      </CardHeader>
      <CardContent>
        <Accordion type="multiple" defaultValue={['live-now']} className="w-full">
          <AccordionItem value="live-now">
            <AccordionTrigger className="font-semibold">Live Now ({liveStreamersData.length})</AccordionTrigger>
            <AccordionContent>
              <ScrollArea className="h-[28rem]">
                <div className="space-y-1 pr-4">
                  {liveStreamersData.map((player) => (
                    <div key={player.id} className="flex items-center justify-between gap-3 p-2 rounded-md transition-colors hover:bg-accent/50">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="relative">
                          <Avatar className="h-9 w-9">
                            <AvatarImage src={player.avatar} alt={player.username} />
                            <AvatarFallback>{player.username.charAt(0)}</AvatarFallback>
                          </Avatar>
                          <span className="absolute bottom-0 right-0 block h-2.5 w-2.5 rounded-full bg-green-500 ring-2 ring-card animate-pulse" />
                        </div>
                        <Link href={`https://www.twitch.tv/${player.username}`} target="_blank" rel="noopener noreferrer" className="font-medium truncate hover:underline">
                          {player.username}
                        </Link>
                      </div>
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <MessageSquare className="h-4 w-4"/>
                            <span className="sr-only">Chat</span>
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent side="right" align="start" className="w-auto p-0 border-none">
                          <TwitchChatEmbed username={player.username} />
                        </PopoverContent>
                      </Popover>
                    </div>
                  ))}
                  {liveStreamersData.length === 0 && <p className="text-muted-foreground text-sm p-2">No one is live right now.</p>}
                </div>
              </ScrollArea>
            </AccordionContent>
          </AccordionItem>
          <AccordionItem value="offline">
            <AccordionTrigger className="font-semibold">Community ({offlinePlayers.length})</AccordionTrigger>
            <AccordionContent>
              <ScrollArea className="h-48">
                <div className="space-y-1 pr-4">
                  {offlinePlayers.map((player) => (
                    <div key={player.id} className="flex items-center gap-3 opacity-60 p-2">
                      <div className="relative">
                        <Avatar>
                          <AvatarImage src={player.avatar} alt={player.username} />
                          <AvatarFallback>{player.username.charAt(0)}</AvatarFallback>
                        </Avatar>
                        <span className="absolute bottom-0 right-0 block h-3 w-3 rounded-full bg-gray-500 ring-2 ring-card" />
                      </div>
                      <span className="font-medium truncate">{player.username}</span>
                    </div>
                  ))}
                  {offlinePlayers.length === 0 && <p className="text-muted-foreground text-sm p-2">Everyone is online!</p>}
                </div>
              </ScrollArea>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </CardContent>
    </Card>
  );
}