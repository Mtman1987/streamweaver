import path from 'path';
import { readJsonFile, writeJsonFile } from './storage';

const POINTS_FILE = 'points.json';

type PointsRecord = Record<
  string,
  {
    points: number;
    level: number;
    updatedAt: string;
    lastActivity: string;
    totalEarned: number;
  }
>;

function calculateLevel(points: number): number {
  return Math.max(1, Math.floor(points / 100) + 1);
}

async function loadPoints(): Promise<PointsRecord> {
  return readJsonFile<PointsRecord>(POINTS_FILE, {});
}

async function savePoints(data: PointsRecord): Promise<void> {
  await writeJsonFile(POINTS_FILE, data);
}

export async function getPoints(userId: string): Promise<{ points: number; level: number; totalEarned: number }> {
  const store = await loadPoints();
  const entry = store[userId.toLowerCase()];
  return entry ? { points: entry.points, level: entry.level, totalEarned: entry.totalEarned || 0 } : { points: 0, level: 1, totalEarned: 0 };
}

export async function getAllUsers(): Promise<PointsRecord> {
  return loadPoints();
}

export async function addPointsToAll(amount: number): Promise<number> {
  const store = await loadPoints();
  const now = new Date().toISOString();
  let count = 0;
  
  for (const key in store) {
    const current = store[key];
    const newPoints = Math.max(0, current.points + amount);
    const level = calculateLevel(newPoints);
    const totalEarned = current.totalEarned + (amount > 0 ? amount : 0);
    
    store[key] = {
      points: newPoints,
      level,
      updatedAt: now,
      lastActivity: current.lastActivity,
      totalEarned
    };
    count++;
  }
  
  await savePoints(store);
  console.log(`Added ${amount} points to ${count} users`);
  return count;
}

export async function setPointsToAll(amount: number): Promise<number> {
  const store = await loadPoints();
  const now = new Date().toISOString();
  const points = Math.max(0, amount);
  const level = calculateLevel(points);
  let count = 0;
  
  for (const key in store) {
    const current = store[key];
    store[key] = {
      points,
      level,
      updatedAt: now,
      lastActivity: current.lastActivity,
      totalEarned: current.totalEarned
    };
    count++;
  }
  
  await savePoints(store);
  console.log(`Set ${count} users to ${amount} points`);
  return count;
}

export async function resetAllPoints(): Promise<number> {
  const store = await loadPoints();
  const now = new Date().toISOString();
  let count = 0;
  
  for (const key in store) {
    const current = store[key];
    store[key] = {
      points: 0,
      level: 1,
      updatedAt: now,
      lastActivity: current.lastActivity,
      totalEarned: current.totalEarned
    };
    count++;
  }
  
  await savePoints(store);
  console.log(`Reset points for ${count} users`);
  return count;
}

export async function addPoints(
  userId: string,
  amount: number,
  reason?: string
): Promise<{ points: number; level: number; totalEarned: number }> {
  const store = await loadPoints();
  const key = userId.toLowerCase();
  const now = new Date().toISOString();
  const current = store[key] ?? { points: 0, level: 1, updatedAt: now, lastActivity: now, totalEarned: 0 };
  const newPoints = Math.max(0, current.points + amount);
  const level = calculateLevel(newPoints);
  const totalEarned = current.totalEarned + (amount > 0 ? amount : 0);
  
  store[key] = { 
    points: newPoints, 
    level, 
    updatedAt: now, 
    lastActivity: now,
    totalEarned
  };
  
  await savePoints(store);
  console.log(`Points updated: ${userId} ${amount > 0 ? '+' : ''}${amount} (${reason || 'manual'}) -> ${newPoints} total`);
  return { points: newPoints, level, totalEarned };
}

export async function setPoints(
  userId: string,
  value: number
): Promise<{ points: number; level: number; totalEarned: number }> {
  const store = await loadPoints();
  const key = userId.toLowerCase();
  const now = new Date().toISOString();
  const current = store[key] ?? { points: 0, level: 1, updatedAt: now, lastActivity: now, totalEarned: 0 };
  const points = Math.max(0, value);
  const level = calculateLevel(points);
  
  store[key] = { 
    points, 
    level, 
    updatedAt: now, 
    lastActivity: current.lastActivity,
    totalEarned: current.totalEarned
  };
  
  await savePoints(store);
  return { points, level, totalEarned: current.totalEarned };
}

export async function getLeaderboard(limit = 10): Promise<Array<{ user: string; points: number; level: number; totalEarned: number }>> {
  const store = await loadPoints();
  return Object.entries(store)
    .map(([user, data]) => ({ user, points: data.points, level: data.level, totalEarned: data.totalEarned || 0 }))
    .sort((a, b) => b.points - a.points)
    .slice(0, limit);
}

// Award points for follows, subs, etc.
export async function awardEventPoints(userId: string, event: string, metadata?: any): Promise<void> {
  const settings = await getPointSettings();
  let points = 0;
  
  switch (event) {
    case 'follow':
      points = settings.eventPoints.follow;
      break;
    case 'subscribe':
    case 'sub':
      const tier = metadata?.tier || 'tier1';
      if (tier === 'tier1' || tier === '1000') points = settings.eventPoints.tier1;
      else if (tier === 'tier2' || tier === '2000') points = settings.eventPoints.tier2;
      else if (tier === 'tier3' || tier === '3000') points = settings.eventPoints.tier3;
      else points = settings.eventPoints.tier1;
      
      // Add month bonus
      const months = metadata?.months || 0;
      if (months > 0) {
        points += months * settings.eventPoints.monthBonus;
      }
      break;
    case 'resub':
      const resubTier = metadata?.tier || 'tier1';
      if (resubTier === 'tier1' || resubTier === '1000') points = settings.eventPoints.tier1;
      else if (resubTier === 'tier2' || resubTier === '2000') points = settings.eventPoints.tier2;
      else if (resubTier === 'tier3' || resubTier === '3000') points = settings.eventPoints.tier3;
      else points = settings.eventPoints.tier1;
      
      const resubMonths = metadata?.months || 0;
      if (resubMonths > 0) {
        points += resubMonths * settings.eventPoints.monthBonus;
      }
      break;
    case 'giftSub':
    case 'giftsub':
      const gifts = metadata?.gifts || 1;
      let giftPoints = settings.eventPoints.giftSub;
      
      if (settings.eventPoints.giftSubTierBoost) {
        const giftTier = metadata?.tier || 'tier1';
        let tierBonus = settings.eventPoints.tier1;
        if (giftTier === 'tier2' || giftTier === '2000') tierBonus = settings.eventPoints.tier2;
        else if (giftTier === 'tier3' || giftTier === '3000') tierBonus = settings.eventPoints.tier3;
        giftPoints += tierBonus;
      }
      
      points = giftPoints * gifts;
      break;
    case 'cheer':
    case 'bits':
      const bits = metadata?.bits || 0;
      points = bits * settings.eventPoints.bitsMultiplier;
      break;
    case 'raid':
      const viewers = metadata?.viewers || 0;
      points = settings.eventPoints.raid + (viewers * settings.eventPoints.raidPerViewer);
      break;
    case 'host':
      points = settings.eventPoints.host;
      break;
    case 'firstWords':
      points = settings.eventPoints.firstWords;
      break;
  }
  
  if (points > 0) {
    await addPoints(userId, points, event);
  }
}

// Auto-award points for chat activity
export async function awardChatPoints(userId: string): Promise<void> {
  const store = await loadPoints();
  const key = userId.toLowerCase();
  const now = new Date();
  const current = store[key];
  
  const settings = await getPointSettings();
  const cooldown = settings.chatCooldown || 15;
  
  // Only award if last activity was more than cooldown seconds ago
  if (current?.lastActivity) {
    const lastActivity = new Date(current.lastActivity);
    const timeDiff = now.getTime() - lastActivity.getTime();
    if (timeDiff < cooldown * 1000) return;
  }
  
  // Random points between min and max
  const min = settings.minChatPoints || 10;
  const max = settings.maxChatPoints || 15;
  const points = Math.floor(Math.random() * (max - min + 1)) + min;
  
  await addPoints(userId, points, 'chat activity');
}

// Point settings management
const SETTINGS_FILE = 'point-settings.json';
const REWARDS_FILE = 'channel-point-rewards.json';

export type PointSettings = {
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
};

export type ChannelPointReward = {
  name: string;
  points: number;
  message: string;
};

const defaultSettings: PointSettings = {
  minChatPoints: 10,
  maxChatPoints: 15,
  chatCooldown: 15,
  eventPoints: {
    follow: 100,
    subscribe: 100,
    tier1: 300,
    tier2: 700,
    tier3: 1900,
    monthBonus: 10,
    resub: 25,
    giftSub: 200,
    giftSubTierBoost: false,
    cheer: 5,
    bitsMultiplier: 1,
    raid: 250,
    raidPerViewer: 5,
    host: 15,
    firstWords: 50
  }
};

export async function getPointSettings(): Promise<PointSettings> {
  return readJsonFile<PointSettings>(SETTINGS_FILE, defaultSettings);
}

export async function updatePointSettings(settings: Partial<PointSettings> & { eventPoints?: Partial<PointSettings['eventPoints']> }): Promise<void> {
  const current = await getPointSettings();
  const updated = {
    ...current,
    ...settings,
    eventPoints: {
      ...current.eventPoints,
      ...(settings.eventPoints ?? {}),
    },
  };
  await writeJsonFile(SETTINGS_FILE, updated);
}

export async function getChannelPointRewards(): Promise<ChannelPointReward[]> {
  return readJsonFile<ChannelPointReward[]>(REWARDS_FILE, [
    { name: 'first', points: 100, message: 'Congrats on being first!' },
    { name: 'hydrate', points: -100, message: 'Stay hydrated! 💧' },
    { name: 'stretch', points: -100, message: 'Time to stretch! 🤸' }
  ]);
}

export async function updateChannelPointRewards(rewards: ChannelPointReward[]): Promise<void> {
  await writeJsonFile(REWARDS_FILE, rewards);
}

export async function getUserPoints(userId: string): Promise<number> {
  const data = await getPoints(userId);
  return data.points;
}

export async function updateUserPoints(userId: string, value: number): Promise<void> {
  await setPoints(userId, value);
}

/**
 * Syncs points data and broadcasts updates to clients
 */
export async function syncPointsData(): Promise<void> {
  try {
    // Get current leaderboard
    const leaderboard = await getLeaderboard(10);
    
    // Broadcast points update to connected clients
    if (typeof (global as any).broadcast === 'function') {
      (global as any).broadcast({
        type: 'points-leaderboard-update',
        payload: { leaderboard }
      });
    }
  } catch (error) {
    console.error('[Points] Sync error:', error);
  }
}
