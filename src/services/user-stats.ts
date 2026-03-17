import fs from 'fs';
import path from 'path';
import { getPoints as getPointsData, addPoints as addPointsData } from './points';

type MasterStatsEntry = {
  Points?: number;
  Watchtime?: number;
  Deaths?: number;
  JoinDate?: string;
  Visits?: number;
  LastSeen?: string;
  TotalCards?: number;
  RareCards?: number;
  Badges?: string[];
};

const STATS_FILE = path.join(process.cwd(), 'data', 'user-stats.json');
const MASTER_STATS_FILE = path.join(process.cwd(), 'MasterStats', 'allUsers.json');

export interface UserStats {
  user: string;
  points: number;
  watchtime: number;
  deaths: number;
  joinDate: string;
  visits: number;
  lastSeen: string;
  totalCards: number;
  rareCards: number;
  badges: string[];
  cardCollection: string[];
}

let statsCache: Record<string, UserStats> = {};
let lastSave = 0;

function loadStats(): Record<string, UserStats> {
  if (!fs.existsSync(STATS_FILE)) {
    fs.mkdirSync(path.dirname(STATS_FILE), { recursive: true });
    fs.writeFileSync(STATS_FILE, '{}');
    return {};
  }
  return JSON.parse(fs.readFileSync(STATS_FILE, 'utf-8'));
}

async function saveStats() {
  const now = Date.now();
  if (now - lastSave < 1000) return;
  
  fs.writeFileSync(STATS_FILE, JSON.stringify(statsCache, null, 2));
  lastSave = now;
}

export async function getUser(username: string): Promise<UserStats> {
  // Only load from disk if cache is empty
  if (Object.keys(statsCache).length === 0) {
    statsCache = loadStats();
  }
  
  if (!statsCache[username]) {
    const pointsData = await getPointsData(username);
    // Check Discord for cross-stream gym badges
    let badges: string[] = [];
    try {
      const { getUserBadgesFromDiscord } = require('./badge-storage-discord');
      badges = await getUserBadgesFromDiscord(username);
    } catch {}
    statsCache[username] = {
      user: username,
      points: pointsData.points,
      watchtime: 0,
      deaths: 0,
      joinDate: new Date().toISOString(),
      visits: 1,
      lastSeen: new Date().toISOString(),
      totalCards: 0,
      rareCards: 0,
      badges,
      cardCollection: []
    };
    await saveStats();
  } else {
    // Sync points from points.json
    const pointsData = await getPointsData(username);
    statsCache[username].points = pointsData.points;
  }
  
  return statsCache[username];
}

export async function updateUser(username: string, updates: Partial<UserStats>) {
  const user = statsCache[username];
  if (!user) {
    console.error(`[UserStats] Cannot update user ${username} - not in cache`);
    return;
  }
  Object.assign(user, updates);
  user.lastSeen = new Date().toISOString();
  statsCache[username] = user;
  console.log(`[UserStats] Saving stats for ${username}...`);
  await saveStats();
}

export async function addCards(username: string, cards: any[]) {
  // Reload cache to get latest data
  statsCache = loadStats();
  
  // Ensure user exists
  if (!statsCache[username]) {
    console.log(`[UserStats] Creating new user ${username} for card collection`);
    const pointsData = await getPointsData(username);
    statsCache[username] = {
      user: username,
      points: pointsData.points,
      watchtime: 0,
      deaths: 0,
      joinDate: new Date().toISOString(),
      visits: 1,
      lastSeen: new Date().toISOString(),
      totalCards: 0,
      rareCards: 0,
      badges: [],
      cardCollection: []
    };
  }
  
  const user = statsCache[username];
  const cardNames: string[] = [];
  
  for (const card of cards) {
    const cardId = `${card.setCode}-${card.number}`;
    if (!user.cardCollection.includes(cardId)) {
      user.cardCollection.push(cardId);
      user.totalCards++;
      cardNames.push(card.name);
      
      if (card.rarity.includes('Rare') || card.rarity.includes('Holo')) {
        user.rareCards++;
      }
    }
  }
  
  await updateUser(username, user);
  console.log(`[UserStats] ${username} now has ${user.totalCards} cards (${user.rareCards} rare)`);
  
  return cardNames;
}

export async function getLeaderboard(stat: 'points' | 'watchtime' | 'totalCards' | 'rareCards' | 'badges', limit = 10) {
  statsCache = loadStats();
  
  // Sync all points
  for (const username of Object.keys(statsCache)) {
    const pointsData = await getPointsData(username);
    statsCache[username].points = pointsData.points;
  }
  
  const exclude = ['blerp', 'mtman1987', 'athenabot87', 'streamelements', 'frostytoolsdotcom'];
  const users = Object.values(statsCache).filter(u => !exclude.includes(u.user.toLowerCase()));
  
  const sorted = users.sort((a, b) => {
    if (stat === 'badges') {
      return b.badges.length - a.badges.length;
    }
    return (b[stat] as number) - (a[stat] as number);
  });
  
  return sorted.slice(0, limit);
}

export async function getUserRank(username: string, stat: 'points' | 'watchtime' | 'totalCards' | 'rareCards' | 'badges'): Promise<number> {
  const leaderboard = await getLeaderboard(stat, 9999);
  return leaderboard.findIndex(u => u.user.toLowerCase() === username.toLowerCase()) + 1;
}

export async function awardGymBadge(username: string, badge: string): Promise<void> {
  const user = await getUser(username);
  if (!user.badges.includes(badge)) {
    user.badges.push(badge);
    await updateUser(username, { badges: user.badges });
    console.log(`[UserStats] ${username} earned gym badge: ${badge}`);
    // Persist to Discord for cross-stream sync
    try {
      const { saveUserBadgesToDiscord } = require('./badge-storage-discord');
      await saveUserBadgesToDiscord(username, user.badges);
    } catch (err) {
      console.error('[UserStats] Badge Discord sync failed:', err);
    }
  }
}

export async function getUserBadges(username: string): Promise<string[]> {
  const user = await getUser(username);
  return user.badges;
}

export async function incrementWatchtime(usernames: string[]): Promise<void> {
  if (usernames.length === 0) return;
  if (Object.keys(statsCache).length === 0) statsCache = loadStats();

  const now = new Date().toISOString();
  for (const name of usernames) {
    const key = name.toLowerCase();
    if (!statsCache[key]) {
      const pointsData = await getPointsData(key);
      statsCache[key] = {
        user: key, points: pointsData.points, watchtime: 0, deaths: 0,
        joinDate: now, visits: 1, lastSeen: now,
        totalCards: 0, rareCards: 0, badges: [], cardCollection: []
      };
    }
    statsCache[key].watchtime += 1;
    statsCache[key].lastSeen = now;
  }
  await saveStats();
}

function initializeCache() {
  statsCache = loadStats();
  console.log(`[UserStats] Loaded ${Object.keys(statsCache).length} users from cache`);
}

initializeCache();
