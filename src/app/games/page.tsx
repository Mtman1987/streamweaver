'use client';

import { BingoCard } from '@/components/bingo-card';
import { CommunityList } from '@/components/community-list';
import { ChatTagGame } from '@/components/chat-tag-game';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

export default function GamesPage() {
  return (
    <div className="space-y-6">
      <Tabs defaultValue="bingo" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="bingo">Stream Bingo</TabsTrigger>
          <TabsTrigger value="tag">Tag Game</TabsTrigger>
          <TabsTrigger value="community">Live Streams</TabsTrigger>
        </TabsList>
        
        <TabsContent value="bingo" className="space-y-4">
          <div className="text-center space-y-2">
            <h2 className="text-3xl font-bold">Stream Bingo</h2>
            <p className="text-muted-foreground">
              Play bingo while watching streams! Click squares when you see these moments happen.
            </p>
          </div>
          <BingoCard />
        </TabsContent>
        
        <TabsContent value="tag" className="space-y-4">
          <div className="text-center space-y-2">
            <h2 className="text-3xl font-bold">Chat Tag Game</h2>
            <p className="text-muted-foreground">
              Tag other community members in chat! Click "Join Game" to participate.
            </p>
          </div>
          <ChatTagGame />
        </TabsContent>
        
        <TabsContent value="community" className="space-y-4">
          <div className="text-center space-y-2">
            <h2 className="text-3xl font-bold">Live Community Streams</h2>
            <p className="text-muted-foreground">
              See who's streaming right now from the community!
            </p>
          </div>
          <CommunityList />
        </TabsContent>
      </Tabs>
    </div>
  );
}