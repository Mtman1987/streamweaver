'use client';

import { useState, useEffect } from 'react';
import { LiveStreamersProvider } from '@/contexts/live-streamers-context';

export default function GamesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [user, setUser] = useState<any>(null);

  useEffect(() => {
    // Check URL for user data from OAuth callback
    const urlParams = new URLSearchParams(window.location.search);
    const userParam = urlParams.get('user');
    
    if (userParam) {
      const userData = JSON.parse(decodeURIComponent(userParam));
      localStorage.setItem('games_user', JSON.stringify(userData));
      setUser(userData);
      // Clean URL
      window.history.replaceState({}, '', '/games');
      return;
    }
    
    // Check if user is already logged in
    const savedUser = localStorage.getItem('games_user');
    if (savedUser) {
      setUser(JSON.parse(savedUser));
    }
  }, []);

  const handleTwitchLogin = () => {
    const clientId = process.env.NEXT_PUBLIC_TWITCH_CLIENT_ID;
    const redirectUri = `${window.location.origin}/auth/twitch/callback`;
    const scope = 'user:read:email';
    const state = 'games'; // Identify this as games login
    
    window.location.href = `https://id.twitch.tv/oauth2/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=code&scope=${scope}&state=${state}`;
  };

  if (!user) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-4">
          <h1 className="text-4xl font-bold">StreamWeaver Games</h1>
          <p className="text-muted-foreground">Join the community games!</p>
          <button 
            onClick={handleTwitchLogin}
            className="bg-purple-600 hover:bg-purple-700 text-white px-6 py-3 rounded-lg font-medium"
          >
            Login with Twitch
          </button>
        </div>
      </div>
    );
  }

  return (
    <LiveStreamersProvider>
      <div className="min-h-screen bg-background">
        <header className="border-b p-4">
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-bold">StreamWeaver Games</h1>
            <div className="flex items-center gap-2">
              <img src={user.avatar} alt={user.username} className="w-8 h-8 rounded-full" />
              <span>{user.username}</span>
            </div>
          </div>
        </header>
        <main className="p-4">
          {children}
        </main>
      </div>
    </LiveStreamersProvider>
  );
}