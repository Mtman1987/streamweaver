'use client';

import { CommunityList } from '@/components/community-list';

export default function GamesPage() {
  return (
    <div className="space-y-6">
      <div className="text-center space-y-2">
        <h2 className="text-3xl font-bold">Live Community Streams</h2>
        <p className="text-muted-foreground">
          See who's streaming right now from the community!
        </p>
      </div>
      <CommunityList />
    </div>
  );
}
