'use client';

import { useState, useEffect } from 'react';
import { Trophy, Crown, Medal, Star } from 'lucide-react';

interface LeaderboardEntry {
  user: string;
  points: number;
  level: number;
}

export default function LeaderboardOverlay() {
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [visible, setVisible] = useState(false);

  const fetchLeaderboard = async () => {
    try {
      const response = await fetch('/api/points?action=leaderboard&limit=5');
      const data = await response.json();
      setLeaderboard(data.leaderboard || []);
    } catch (error) {
      console.error('Failed to fetch leaderboard:', error);
    }
  };

  useEffect(() => {
    fetchLeaderboard();
    const interval = setInterval(fetchLeaderboard, 10000);
    return () => clearInterval(interval);
  }, []);

  const getRankIcon = (index: number) => {
    switch (index) {
      case 0: return <Crown className="w-6 h-6 text-yellow-400" />;
      case 1: return <Trophy className="w-6 h-6 text-gray-300" />;
      case 2: return <Medal className="w-6 h-6 text-amber-600" />;
      default: return <Star className="w-5 h-5 text-blue-400" />;
    }
  };

  if (!visible || leaderboard.length === 0) {
    return (
      <div className="fixed top-4 right-4 z-50">
        <button
          onClick={() => setVisible(true)}
          className="bg-black/80 text-white px-4 py-2 rounded-lg border border-white/20 hover:bg-black/90 transition-colors"
        >
          Show Leaderboard
        </button>
      </div>
    );
  }

  return (
    <div className="fixed top-4 right-4 z-50 bg-black/90 backdrop-blur-sm border border-white/20 rounded-lg p-4 min-w-[300px]">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Trophy className="w-5 h-5 text-yellow-400" />
          <h2 className="text-white font-bold text-lg">Top Viewers</h2>
        </div>
        <button
          onClick={() => setVisible(false)}
          className="text-white/60 hover:text-white text-xl leading-none"
        >
          ×
        </button>
      </div>
      
      <div className="space-y-2">
        {leaderboard.map((entry, index) => (
          <div
            key={entry.user}
            className="flex items-center justify-between p-2 rounded bg-white/10"
          >
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 min-w-[50px]">
                {getRankIcon(index)}
                <span className="text-white font-semibold">#{index + 1}</span>
              </div>
              <div>
                <div className="text-white font-medium">{entry.user}</div>
                <div className="text-white/60 text-sm">Level {entry.level}</div>
              </div>
            </div>
            <div className="text-yellow-400 font-bold">
              {entry.points.toLocaleString()}
            </div>
          </div>
        ))}
      </div>
      
      <div className="mt-4 text-center">
        <div className="text-white/60 text-sm">
          Chat to earn points! • Updates every 10s
        </div>
      </div>
    </div>
  );
}