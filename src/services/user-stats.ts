import fs from 'fs';
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
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
const statsVersions = new Map<string, string>();
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
  let version = '';
  try { const stat = fs.statSync(statsFile(ctx)); version = stat.mtimeMs + ':' + stat.size + ':' + stat.ino; } catch {}
  if (cached && statsVersions.get(key) === version) return cached;

  const filePath = statsFile(ctx);
  if (!fs.existsSync(filePath)) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const migrated = Object.assign(Object.create(null),readLegacyTenantStats(ctx));
    fs.writeFileSync(filePath, JSON.stringify(migrated, null, 2));
    statsCaches.set(key, migrated);
    const created = fs.statSync(filePath); statsVersions.set(key, created.mtimeMs + ':' + created.size + ':' + created.ino);
    if (Object.keys(migrated).length > 0) {
      console.log('[UserStats] Migrated ' + Object.keys(migrated).length + ' users into tenant ' + key);
    }
    return migrated;
  }
  const raw = Object.assign(Object.create(null),JSON.parse(fs.readFileSync(filePath, 'utf-8')));
  for (const key of Object.keys(raw)) {
    if (!raw[key].watchtimeByChannel) {
      raw[key].watchtimeByChannel = raw[key].watchtime ? { unknown: raw[key].watchtime } : {};
    }
  }
  statsCaches.set(key, raw);
  statsVersions.set(key, version);
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
    const written = fs.statSync(filePath); statsVersions.set(key, written.mtimeMs + ':' + written.size + ':' + written.ino);
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

async function getUserUnlocked(username: string, ctx?: StorageContext): Promise<UserStats> {
  username = username.trim().replace(/^@/,'').toLowerCase();
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

async function updateUserUnlocked(username: string, updates: Partial<UserStats>, ctx?: StorageContext) {
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

async function addCardsUnlocked(username: string, cards: any[], ctx?: StorageContext) {
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
  await withWatchtimeLock(ctx, async () => {
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
  });
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
  statsVersions.clear();
  saveLocks.clear();
}

const heldWatchLocks = new AsyncLocalStorage<Set<string>>();
async function withWatchtimeLock<T>(ctx: StorageContext | undefined, task: () => Promise<T>): Promise<T> {
  const lockPath = statsFile(ctx) + '.watch.lock';
  if (heldWatchLocks.getStore()?.has(lockPath)) return task();
  const token = randomUUID();
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  const deadline = Date.now() + 20_000;
  let fd: number;
  while (true) {
    try { fd = fs.openSync(lockPath, 'wx'); fs.writeSync(fd, token); break; }
    catch (error: any) {
      if (error.code !== 'EEXIST') throw error;
      try { if (Date.now() - fs.statSync(lockPath).mtimeMs > 120_000) fs.unlinkSync(lockPath); } catch {}
      if (Date.now() > deadline) throw new Error('Watchtime is busy. Try the import again shortly.');
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }
  try { return await heldWatchLocks.run(new Set([...(heldWatchLocks.getStore() || []),lockPath]),task); }
  finally { fs.closeSync(fd!); try { if (fs.readFileSync(lockPath,'utf8') === token) fs.unlinkSync(lockPath); } catch {} }
}

export async function snapshotWatchtime(ctx: StorageContext): Promise<Record<string, UserStats>> {
  if (!ctx.tenantId || !ctx.username) throw new Error('Tenant context is required.');
  return structuredClone(loadStats(ctx));
}

export async function importWatchtimeMinutes(rows: Array<{ username: string; watchMinutes?: number }>, channel: string, ctx: StorageContext): Promise<void> {
  if (!ctx.tenantId || !ctx.username) throw new Error('Tenant context is required.');
  await withWatchtimeLock(ctx, async () => {
    const stats = loadStats(ctx), now = new Date().toISOString(), channelKey = channel.toLowerCase();
    for (const row of rows) {
      if (row.watchMinutes === undefined) continue;
      const user = stats[row.username] ||= { user:row.username, points:0, watchtime:0, watchtimeByChannel:{}, deaths:0, joinDate:now, visits:0, lastSeen:now, totalCards:0, rareCards:0, badges:[], cardCollection:[] };
      user.watchtimeByChannel ||= {};
      const delta = Math.max(0,row.watchMinutes - totalWatchtime(user));
      if (delta) user.watchtimeByChannel[channelKey] = (user.watchtimeByChannel[channelKey] || 0) + delta;
      user.watchtime = totalWatchtime(user);
    }
    await saveStats(ctx);
  });
}

export async function getUser(...args: Parameters<typeof getUserUnlocked>) { return withWatchtimeLock(args[1],()=>getUserUnlocked(...args)); }
export async function updateUser(...args: Parameters<typeof updateUserUnlocked>) { return withWatchtimeLock(args[2],()=>updateUserUnlocked(...args)); }
export async function addCards(...args: Parameters<typeof addCardsUnlocked>) { return withWatchtimeLock(args[2],()=>addCardsUnlocked(...args)); }
