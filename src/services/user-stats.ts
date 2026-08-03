import fs from 'fs';
import path from 'path';
import { getPoints as getPointsData } from './points';
import { tenantPath } from '@/lib/tenant';
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

const statsCaches = new Map<string, Record<string, UserStats>>();
const saveLocks = new Map<string, Promise<void>>();

function contextKey(ctx?: StorageContext): string {
  if (ctx?.tenantId) return ctx.tenantId;
  return '__global__';
}

function statsFile(ctx?: StorageContext): string {
  if (ctx?.tenantId) return tenantPath(ctx.tenantId, 'data/user-stats.json');
  return path.join(process.cwd(), 'data', 'user-stats.json');
}

function readLegacyTenantStats(ctx?: StorageContext): Record<string, UserStats> {
  if (!ctx?.tenantId || !ctx.username) return {};
  const legacyPath = path.join(process.cwd(), 'data', 'user-stats.json');
  if (!fs.existsSync(legacyPath)) return {};

  try {
    const legacy = JSON.parse(fs.readFileSync(legacyPath, 'utf-8')) as Record<string, UserStats>;
    const channelKey = ctx.username.toLowerCase();
    const migrated: Record<string, UserStats> = {};
    for (const [username, user] of Object.entries(legacy)) {
      const channelMinutes = Number(user?.watchtimeByChannel?.[channelKey] || 0);
      if (channelMinutes <= 0) continue;
      migrated[username] = {
        ...user,
        watchtime: channelMinutes,
        watchtimeByChannel: { [channelKey]: channelMinutes },
      };
    }
    return migrated;
  } catch (error) {
    console.warn('[UserStats] Legacy tenant migration skipped:', error);
    return {};
  }
}

function loadStats(ctx?: StorageContext): Record<string, UserStats> {
  const key = contextKey(ctx);
  const cached = statsCaches.get(key);
  if (cached) return cached;

  const filePath = statsFile(ctx);
  if (!fs.existsSync(filePath)) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const migrated = readLegacyTenantStats(ctx);
    fs.writeFileSync(filePath, JSON.stringify(migrated, null, 2));
    statsCaches.set(key, migrated);
    if (Object.keys(migrated).length > 0) {
      console.log('[UserStats] Migrated ' + Object.keys(migrated).length + ' users into tenant ' + key);
    }
    return migrated;
  }
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  for (const key of Object.keys(raw)) {
    if (!raw[key].watchtimeByChannel) {
      raw[key].watchtimeByChannel = raw[key].watchtime ? { unknown: raw[key].watchtime } : {};
    }
  }
  statsCaches.set(key, raw);
  return raw;
}

async function saveStats(ctx?: StorageContext): Promise<void> {
  const key = contextKey(ctx);
  const filePath = statsFile(ctx);
  const previous = saveLocks.get(key) || Promise.resolve();
  const next = previous.then(async () => {
    const stats = statsCaches.get(key) || {};
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tempPath = filePath + '.tmp.' + process.pid + '.' + Date.now();
    fs.writeFileSync(tempPath, JSON.stringify(stats, null, 2));
    fs.renameSync(tempPath, filePath);
  });
  saveLocks.set(key, next);
  try {
    await next;
  } finally {
    if (saveLocks.get(key) === next) saveLocks.delete(key);
  }
}

function totalWatchtime(user: UserStats): number {
  return Object.values(user.watchtimeByChannel || {}).reduce((a, b) => a + b, 0);
}

export async function getUser(username: string, ctx?: StorageContext): Promise<UserStats> {
  const statsCache = loadStats(ctx);
  
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
    await saveStats(ctx);
  } else {
    const pointsData = await getPointsData(username, ctx);
    statsCache[username].points = pointsData.points;
    statsCache[username].watchtime = totalWatchtime(statsCache[username]);
    try {
      const { getUserBadges: getBadges } = require('./badge-storage-discord');
      const globalBadges = await getBadges(username);
      statsCache[username].badges = Array.from(new Set([...(statsCache[username].badges || []), ...globalBadges]));
    } catch {}
    try {
      if (ctx?.tenantId) throw new Error('tenant stats are authoritative');
      const { getUserCards } = require('./pokemon-collection');
      const cards = await getUserCards(username);
      statsCache[username].totalCards = cards.length;
      statsCache[username].rareCards = cards.filter((c: any) => c.rarity?.includes('Rare')).length;
    } catch {}
  }
  
  return statsCache[username];
}

export async function updateUser(username: string, updates: Partial<UserStats>, ctx?: StorageContext) {
  const statsCache = loadStats(ctx);
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
  await saveStats(ctx);
}

export async function addCards(username: string, cards: any[], ctx?: StorageContext) {
  const statsCache = loadStats(ctx);
  
  if (!statsCache[username]) {
    console.log(`[UserStats] Creating new user ${username} for card collection`);
    const pointsData = await getPointsData(username, ctx);
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
  
  await updateUser(username, user, ctx);
  console.log(`[UserStats] ${username} now has ${user.totalCards} cards (${user.rareCards} rare)`);
  
  return cardNames;
}

export async function getLeaderboard(stat: 'points' | 'watchtime' | 'totalCards' | 'rareCards' | 'badges', limit = 10, ctx?: StorageContext) {
  const statsCache = loadStats(ctx);
  
  for (const username of Object.keys(statsCache)) {
    const pointsData = await getPointsData(username, ctx);
    statsCache[username].points = pointsData.points;
    statsCache[username].watchtime = totalWatchtime(statsCache[username]);
  }

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

export async function awardGymBadge(username: string, badge: string, ctx?: StorageContext): Promise<void> {
  const user = await getUser(username, ctx);
  if (!user.badges.includes(badge)) {
    user.badges.push(badge);
    await updateUser(username, { badges: user.badges }, ctx);
    console.log(`[UserStats] ${username} earned gym badge: ${badge}`);
    try {
      const { saveUserBadges } = require('./badge-storage-discord');
      await saveUserBadges(username, user.badges);
    } catch (err) {
      console.error('[UserStats] Badge save failed:', err);
    }
  }
}

export async function getUserBadges(username: string, ctx?: StorageContext): Promise<string[]> {
  const user = await getUser(username, ctx);
  return user.badges;
}

export async function incrementWatchtime(usernames: string[], channel?: string, ctx?: StorageContext): Promise<void> {
  if (usernames.length === 0) return;
  const statsCache = loadStats(ctx);

  const channelKey = (channel || 'unknown').toLowerCase();
  const now = new Date().toISOString();
  for (const name of usernames) {
    const key = name.toLowerCase();
    if (!statsCache[key]) {
      const pointsData = await getPointsData(key, ctx);
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
  await saveStats(ctx);
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

export function clearUserStatsCacheForTests(): void {
  statsCaches.clear();
  saveLocks.clear();
}
