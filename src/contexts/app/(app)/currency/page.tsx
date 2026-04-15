'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Trophy, Crown, Medal, Star, Plus, Minus, Settings } from 'lucide-react';

interface LeaderboardEntry {
  user: string;
  points: number;
  level: number;
}

interface UserPoints {
  userId: string;
  points: number;
  level: number;
}

interface PointSettings {
  minChatPoints: number;
  maxChatPoints: number;
  chatCooldown: number;
  eventPoints: {
    follow: number;
    subscribe: number;
    tier1: number;
    tier2: number;
    tier3: number;
    monthBonus: number;
    resub: number;
    giftSub: number;
    giftSubTierBoost: boolean;
    cheer: number;
    bitsMultiplier: number;
    raid: number;
    raidPerViewer: number;
    host: number;
    firstWords: number;
  };
}


export default function CurrencyPage() {
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [userLookup, setUserLookup] = useState('');
  const [userPoints, setUserPoints] = useState<UserPoints | null>(null);
  const [adminUser, setAdminUser] = useState('');
  const [adminAmount, setAdminAmount] = useState('');
  const [settings, setSettings] = useState<PointSettings | null>(null);
  const [loading, setLoading] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  const fetchLeaderboard = async () => {
    try {
      const response = await fetch('/api/points?action=leaderboard&limit=20');
      const data = await response.json();
      setLeaderboard(data.leaderboard || []);
    } catch (error) {
      console.error('Failed to fetch leaderboard:', error);
    }
  };

  const fetchSettings = async () => {
    try {
      const settingsRes = await fetch('/api/point-settings');
      const settingsData = await settingsRes.json();
      setSettings({
        minChatPoints: settingsData.minChatPoints ?? 10,
        maxChatPoints: settingsData.maxChatPoints ?? 15,
        chatCooldown: settingsData.chatCooldown ?? 15,
        eventPoints: {
          follow: 100, subscribe: 100, tier1: 300, tier2: 700, tier3: 1900,
          monthBonus: 10, resub: 25, giftSub: 200, giftSubTierBoost: false,
          cheer: 5, bitsMultiplier: 1, raid: 250, raidPerViewer: 5, host: 15, firstWords: 50,
          ...settingsData.eventPoints,
        },
      });
    } catch (error) {
      console.error('Failed to fetch settings:', error);
    }
  };

  const updateSettings = async () => {
    if (!settings) return;
    
    setLoading(true);
    try {
      const response = await fetch('/api/point-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings)
      });
      
      if (response.ok) {
        const updated = await response.json();
        setSettings(updated);
      }
    } catch (error) {
      console.error('Failed to update settings:', error);
    } finally {
      setLoading(false);
    }
  };



  const lookupUser = async () => {
    if (!userLookup.trim()) return;
    
    setLoading(true);
    try {
      const response = await fetch(`/api/points?action=get&userId=${encodeURIComponent(userLookup)}`);
      const data = await response.json();
      setUserPoints(data);
    } catch (error) {
      console.error('Failed to lookup user:', error);
    } finally {
      setLoading(false);
    }
  };

  const modifyPoints = async (action: 'add' | 'set') => {
    if (!adminUser.trim() || !adminAmount.trim()) return;
    
    const amount = parseInt(adminAmount);
    if (isNaN(amount)) return;

    setLoading(true);
    try {
      const response = await fetch('/api/points', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          userId: adminUser,
          amount: action === 'add' ? amount : undefined,
          value: action === 'set' ? amount : undefined
        })
      });
      
      if (response.ok) {
        await fetchLeaderboard();
        setAdminUser('');
        setAdminAmount('');
      }
    } catch (error) {
      console.error('Failed to modify points:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLeaderboard();
    fetchSettings();
    const interval = setInterval(fetchLeaderboard, 30000);
    return () => clearInterval(interval);
  }, []);

  const getRankIcon = (index: number) => {
    switch (index) {
      case 0: return <Crown className="w-5 h-5 text-yellow-500" />;
      case 1: return <Trophy className="w-5 h-5 text-gray-400" />;
      case 2: return <Medal className="w-5 h-5 text-amber-600" />;
      default: return <Star className="w-4 h-4 text-blue-500" />;
    }
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold">Currency System</h1>
        <div className="flex gap-2">
          <Button 
            onClick={() => setShowSettings(!showSettings)} 
            variant="outline"
          >
            <Settings className="w-4 h-4 mr-2" />
            Settings
          </Button>
          <Button onClick={fetchLeaderboard} disabled={loading}>
            Refresh
          </Button>
        </div>
      </div>

      {showSettings && settings && (
        <Card>
          <CardHeader>
            <CardTitle>Point Settings</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <Label>Min Chat Points</Label>
                <Input
                  type="number"
                  value={settings.minChatPoints ?? 0}
                  onChange={(e) => setSettings({
                    ...settings,
                    minChatPoints: parseInt(e.target.value) || 0
                  })}
                />
              </div>
              <div>
                <Label>Max Chat Points</Label>
                <Input
                  type="number"
                  value={settings.maxChatPoints ?? 0}
                  onChange={(e) => setSettings({
                    ...settings,
                    maxChatPoints: parseInt(e.target.value) || 0
                  })}
                />
              </div>
              <div>
                <Label>Chat Cooldown (s)</Label>
                <Input
                  type="number"
                  value={settings.chatCooldown ?? 0}
                  onChange={(e) => setSettings({
                    ...settings,
                    chatCooldown: parseInt(e.target.value) || 0
                  })}
                />
              </div>
              <div>
                <Label>Follow</Label>
                <Input
                  type="number"
                  value={settings.eventPoints.follow ?? 0}
                  onChange={(e) => setSettings({
                    ...settings,
                    eventPoints: {
                      ...settings.eventPoints,
                      follow: parseInt(e.target.value) || 0
                    }
                  })}
                />
              </div>
              <div>
                <Label>Subscribe</Label>
                <Input
                  type="number"
                  value={settings.eventPoints.subscribe ?? 0}
                  onChange={(e) => setSettings({
                    ...settings,
                    eventPoints: {
                      ...settings.eventPoints,
                      subscribe: parseInt(e.target.value) || 0
                    }
                  })}
                />
              </div>
              <div>
                <Label>Resub</Label>
                <Input
                  type="number"
                  value={settings.eventPoints.resub ?? 0}
                  onChange={(e) => setSettings({
                    ...settings,
                    eventPoints: {
                      ...settings.eventPoints,
                      resub: parseInt(e.target.value) || 0
                    }
                  })}
                />
              </div>
              <div>
                <Label>Cheer</Label>
                <Input
                  type="number"
                  value={settings.eventPoints.cheer ?? 0}
                  onChange={(e) => setSettings({
                    ...settings,
                    eventPoints: {
                      ...settings.eventPoints,
                      cheer: parseInt(e.target.value) || 0
                    }
                  })}
                />
              </div>
              <div>
                <Label>Raid</Label>
                <Input
                  type="number"
                  value={settings.eventPoints.raid ?? 0}
                  onChange={(e) => setSettings({
                    ...settings,
                    eventPoints: {
                      ...settings.eventPoints,
                      raid: parseInt(e.target.value) || 0
                    }
                  })}
                />
              </div>
              <div>
                <Label>Host</Label>
                <Input
                  type="number"
                  value={settings.eventPoints.host ?? 0}
                  onChange={(e) => setSettings({
                    ...settings,
                    eventPoints: {
                      ...settings.eventPoints,
                      host: parseInt(e.target.value) || 0
                    }
                  })}
                />
              </div>
            </div>
            <Button onClick={updateSettings} disabled={loading}>
              Save Settings
            </Button>
          </CardContent>
        </Card>
      )}



      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Leaderboard */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Trophy className="w-5 h-5" />
              Leaderboard
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {leaderboard.map((entry, index) => (
                <div
                  key={entry.user}
                  className="flex items-center justify-between p-3 rounded-lg bg-muted/50"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2 min-w-[60px]">
                      {getRankIcon(index)}
                      <span className="font-semibold">#{index + 1}</span>
                    </div>
                    <div>
                      <div className="font-medium">{entry.user}</div>
                      <div className="text-sm text-muted-foreground">
                        Level {entry.level}
                      </div>
                    </div>
                  </div>
                  <Badge variant="secondary" className="text-lg px-3 py-1">
                    {entry.points.toLocaleString()} pts
                  </Badge>
                </div>
              ))}
              {leaderboard.length === 0 && (
                <div className="text-center py-8 text-muted-foreground">
                  No users found. Points will appear here as users earn them.
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* User Lookup & Admin */}
        <div className="space-y-6">
          {/* User Lookup */}
          <Card>
            <CardHeader>
              <CardTitle>User Lookup</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-2">
                <Input
                  placeholder="Username"
                  value={userLookup}
                  onChange={(e) => setUserLookup(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && lookupUser()}
                />
                <Button onClick={lookupUser} disabled={loading}>
                  Search
                </Button>
              </div>
              
              {userPoints && (
                <div className="p-4 rounded-lg bg-muted/50">
                  <div className="font-medium">{userPoints.userId}</div>
                  <div className="text-2xl font-bold">
                    {userPoints.points.toLocaleString()} points
                  </div>
                  <div className="text-sm text-muted-foreground">
                    Level {userPoints.level}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Admin Controls */}
          <Card>
            <CardHeader>
              <CardTitle>Admin Controls</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Input
                placeholder="Username"
                value={adminUser}
                onChange={(e) => setAdminUser(e.target.value)}
              />
              <Input
                type="number"
                placeholder="Amount"
                value={adminAmount}
                onChange={(e) => setAdminAmount(e.target.value)}
              />
              <div className="flex gap-2">
                <Button
                  onClick={() => modifyPoints('add')}
                  disabled={loading}
                  className="flex-1"
                >
                  <Plus className="w-4 h-4 mr-2" />
                  Add
                </Button>
                <Button
                  onClick={() => modifyPoints('set')}
                  disabled={loading}
                  variant="outline"
                  className="flex-1"
                >
                  <Minus className="w-4 h-4 mr-2" />
                  Set
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}