'use client';

import { CommunityList } from '@/components/community-list';
import { ChatTagGame } from '@/components/chat-tag-game';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

export default function GamesPage() {
  return (
    <div className="space-y-6">
      <Tabs defaultValue="tag" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="tag">Tag Game</TabsTrigger>
          <TabsTrigger value="community">Live Streams</TabsTrigger>
        </TabsList>
        
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