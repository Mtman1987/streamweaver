import fs from 'fs';
import path from 'path';
import { getPoints as getPointsData, addPoints as addPointsData } from './points';
import type { StorageContext } from './storage';

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
  watchtimeByChannel: Record<string, number>;
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
  const raw = JSON.parse(fs.readFileSync(STATS_FILE, 'utf-8'));
  // Migrate old entries that lack watchtimeByChannel
  for (const key of Object.keys(raw)) {
    if (!raw[key].watchtimeByChannel) {
      raw[key].watchtimeByChannel = raw[key].watchtime ? { unknown: raw[key].watchtime } : {};
    }
  }
  return raw;
}

async function saveStats() {
  const now = Date.now();
  if (now - lastSave < 1000) return;
  
  fs.writeFileSync(STATS_FILE, JSON.stringify(statsCache, null, 2));
  lastSave = now;
}

function totalWatchtime(user: UserStats): number {
  return Object.values(user.watchtimeByChannel || {}).reduce((a, b) => a + b, 0);
}

export async function getUser(username: string, ctx?: StorageContext): Promise<UserStats> {
  if (Object.keys(statsCache).length === 0) {
    statsCache = loadStats();
  }
  
  if (!statsCache[username]) {
    const pointsData = await getPointsData(username, ctx);
    let badges: string[] = [];
    try {
      const { getUserBadges } = require('./badge-storage-discord');
      badges = await getUserBadges(username);
    } catch {}
    statsCache[username] = {
      user: username,
      points: pointsData.points,
      watchtime: 0,
      watchtimeByChannel: {},
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
    const pointsData = await getPointsData(username, ctx);
    statsCache[username].points = pointsData.points;
    statsCache[username].watchtime = totalWatchtime(statsCache[username]);
    // Refresh badges and cards from real stores
    try {
      const { getUserBadges: getBadges } = require('./badge-storage-discord');
      statsCache[username].badges = await getBadges(username);
    } catch {}
    try {
      const { getUserCards } = require('./pokemon-collection');
      const cards = await getUserCards(username);
      statsCache[username].totalCards = cards.length;
      statsCache[username].rareCards = cards.filter((c: any) => c.rarity?.includes('Rare')).length;
    } catch {}
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
  user.watchtime = totalWatchtime(user);
  statsCache[username] = user;
  console.log(`[UserStats] Saving stats for ${username}...`);
  await saveStats();
}

export async function addCards(username: string, cards: any[]) {
  statsCache = loadStats();
  
  if (!statsCache[username]) {
    console.log(`[UserStats] Creating new user ${username} for card collection`);
    const pointsData = await getPointsData(username);
    statsCache[username] = {
      user: username,
      points: pointsData.points,
      watchtime: 0,
      watchtimeByChannel: {},
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

export async function getLeaderboard(stat: 'points' | 'watchtime' | 'totalCards' | 'rareCards' | 'badges', limit = 10, ctx?: StorageContext) {
  statsCache = loadStats();
  
  for (const username of Object.keys(statsCache)) {
    const pointsData = await getPointsData(username, ctx);
    statsCache[username].points = pointsData.points;
    statsCache[username].watchtime = totalWatchtime(statsCache[username]);
  }

  // Refresh card counts from the real collection for card-related stats
  if (stat === 'totalCards' || stat === 'rareCards') {
    try {
      const { getUserCards } = require('./pokemon-collection');
      for (const username of Object.keys(statsCache)) {
        const cards = await getUserCards(username);
        statsCache[username].totalCards = cards.length;
        statsCache[username].rareCards = cards.filter((c: any) => c.rarity?.includes('Rare')).length;
      }
    } catch {}
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

export async function getUserRank(username: string, stat: 'points' | 'watchtime' | 'totalCards' | 'rareCards' | 'badges', ctx?: StorageContext): Promise<number> {
  const leaderboard = await getLeaderboard(stat, 9999, ctx);
  return leaderboard.findIndex(u => u.user.toLowerCase() === username.toLowerCase()) + 1;
}

export async function awardGymBadge(username: string, badge: string): Promise<void> {
  const user = await getUser(username);
  if (!user.badges.includes(badge)) {
    user.badges.push(badge);
    await updateUser(username, { badges: user.badges });
    console.log(`[UserStats] ${username} earned gym badge: ${badge}`);
    try {
      const { saveUserBadges } = require('./badge-storage-discord');
      await saveUserBadges(username, user.badges);
    } catch (err) {
      console.error('[UserStats] Badge save failed:', err);
    }
  }
}

export async function getUserBadges(username: string): Promise<string[]> {
  const user = await getUser(username);
  return user.badges;
}

export async function incrementWatchtime(usernames: string[], channel?: string): Promise<void> {
  if (usernames.length === 0) return;
  if (Object.keys(statsCache).length === 0) statsCache = loadStats();

  const channelKey = (channel || 'unknown').toLowerCase();
  const now = new Date().toISOString();
  for (const name of usernames) {
    const key = name.toLowerCase();
    if (!statsCache[key]) {
      const pointsData = await getPointsData(key);
      statsCache[key] = {
        user: key, points: pointsData.points, watchtime: 0, watchtimeByChannel: {},
        deaths: 0, joinDate: now, visits: 1, lastSeen: now,
        totalCards: 0, rareCards: 0, badges: [], cardCollection: []
      };
    }
    if (!statsCache[key].watchtimeByChannel) statsCache[key].watchtimeByChannel = {};
    statsCache[key].watchtimeByChannel[channelKey] = (statsCache[key].watchtimeByChannel[channelKey] || 0) + 1;
    statsCache[key].watchtime = totalWatchtime(statsCache[key]);
    statsCache[key].lastSeen = now;
  }
  await saveStats();
}

export function formatWatchtime(user: UserStats): string {
  const total = user.watchtime || 0;
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  const byChannel = user.watchtimeByChannel || {};
  const channels = Object.entries(byChannel)
    .filter(([, m]) => m > 0)
    .sort((a, b) => b[1] - a[1]);

  let msg = `@${user.user} has spent ${hours}h ${minutes}m watching StreamWeaver streams`;
  if (channels.length > 0 && !(channels.length === 1 && channels[0][0] === 'unknown')) {
    const parts = channels
      .filter(([ch]) => ch !== 'unknown')
      .slice(0, 5)
      .map(([ch, m]) => `${Math.floor(m / 60)}h ${m % 60}m in ${ch}'s`);
    if (parts.length > 0) msg += ` — ${parts.join(', ')}`;
  }
  return msg;
}

function initializeCache() {
  statsCache = loadStats();
  console.log(`[UserStats] Loaded ${Object.keys(statsCache).length} users from cache`);
}

initializeCache();
