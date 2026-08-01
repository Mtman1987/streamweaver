import { randomUUID } from 'node:crypto';
import { readJsonFile, writeJsonFile, StorageContext } from './storage';
import { getChatOutputContext } from './chat-output-context';
import {
  addDiscordStreamHubPointsToAll,
  getDiscordStreamHubPoints,
  setDiscordStreamHubPoints,
  setDiscordStreamHubPointsToAll,
  settleDiscordStreamHubGamble,
} from './discord-stream-hub';

const POINTS_FILE = 'points.json';
const MAX_SAFE_POINTS = BigInt(Number.MAX_SAFE_INTEGER);

export type PointAmount = number | string | bigint;

type PointsRecord = Record<
  string,
  {
    points: number | string;
    level: number;
    updatedAt: string;
    lastActivity: string;
    totalEarned: number | string;
  }
>;

function parseDecimalToBigInt(value: string, multiplier: bigint): bigint | null {
  const match = value.match(/^(\d+)(?:\.(\d+))?$/);
  if (!match) return null;

  const whole = BigInt(match[1]);
  const fraction = match[2] || '';
  if (!fraction) return whole * multiplier;

  const scale = 10n ** BigInt(fraction.length);
  const fractional = BigInt(fraction);
  return whole * multiplier + (fractional * multiplier) / scale;
}

export function parsePointAmount(value: PointAmount): bigint {
  if (typeof value === 'bigint') return value;

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(`Unsafe point amount: ${value}`);
    }
    // Legacy points.json files may already contain large JSON numbers such as 1e+21.
    // Convert them best-effort so the next write stores an exact decimal string.
    return BigInt(Math.trunc(value));
  }

  const raw = String(value || '').trim().toLowerCase().replace(/,/g, '').replace(/_/g, '');
  if (!raw) throw new Error('Point amount is required');

  const sign = raw.startsWith('-') ? -1n : 1n;
  const unsigned = raw.replace(/^[+-]/, '');
  const powerMatch = unsigned.match(/^(\d+)(?:\^|\*\*)(\d+)$/);
  if (powerMatch) {
    return sign * (BigInt(powerMatch[1]) ** BigInt(powerMatch[2]));
  }

  const scientificMatch = unsigned.match(/^(\d+(?:\.\d+)?)e\+?(\d+)$/);
  if (scientificMatch) {
    const parsed = parseDecimalToBigInt(scientificMatch[1], 10n ** BigInt(scientificMatch[2]));
    if (parsed === null) throw new Error(`Invalid point amount: ${value}`);
    return sign * parsed;
  }

  const suffixMatch = unsigned.match(/^(\d+(?:\.\d+)?)(k|m|b|t|q|qa|quad|quadrillion|qi|quin|quint|quintillion|sx|sex|sext|sextillion)?$/);
  if (!suffixMatch) throw new Error(`Invalid point amount: ${value}`);

  const suffix = suffixMatch[2] || '';
  const multipliers: Record<string, bigint> = {
    k: 1_000n,
    m: 1_000_000n,
    b: 1_000_000_000n,
    t: 1_000_000_000_000n,
    q: 1_000_000_000_000_000n,
    qa: 1_000_000_000_000_000n,
    quad: 1_000_000_000_000_000n,
    quadrillion: 1_000_000_000_000_000n,
    qi: 1_000_000_000_000_000_000n,
    quin: 1_000_000_000_000_000_000n,
    quint: 1_000_000_000_000_000_000n,
    quintillion: 1_000_000_000_000_000_000n,
    sx: 1_000_000_000_000_000_000_000n,
    sex: 1_000_000_000_000_000_000_000n,
    sext: 1_000_000_000_000_000_000_000n,
    sextillion: 1_000_000_000_000_000_000_000n,
  };

  const parsed = parseDecimalToBigInt(suffixMatch[1], suffix ? multipliers[suffix] : 1n);
  if (parsed === null) throw new Error(`Invalid point amount: ${value}`);
  return sign * parsed;
}

function normalizePoints(value: PointAmount): bigint {
  const parsed = parsePointAmount(value);
  return parsed < 0n ? 0n : parsed;
}

export function normalizeStoredPointAmount(value: PointAmount): bigint {
  try {
    return normalizePoints(value);
  } catch {
    return 0n;
  }
}

function toSafeNumber(value: bigint): number {
  if (value > MAX_SAFE_POINTS) return Number.MAX_SAFE_INTEGER;
  if (value < -MAX_SAFE_POINTS) return -Number.MAX_SAFE_INTEGER;
  return Number(value);
}

export function formatPointAmount(value: PointAmount): string {
  const parsed = parsePointAmount(value);
  const sign = parsed < 0n ? '-' : '';
  const digits = (parsed < 0n ? -parsed : parsed).toString();
  return sign + digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

const COMPACT_UNITS: Array<{ value: bigint; suffix: string }> = [
  { value: 1_000_000_000_000_000_000_000n, suffix: 'sx' },
  { value: 1_000_000_000_000_000_000n, suffix: 'qi' },
  { value: 1_000_000_000_000_000n, suffix: 'q' },
  { value: 1_000_000_000_000n, suffix: 't' },
  { value: 1_000_000_000n, suffix: 'b' },
  { value: 1_000_000n, suffix: 'm' },
  { value: 1_000n, suffix: 'k' },
];

export function formatCompactPointAmount(value: PointAmount): string {
  const parsed = parsePointAmount(value);
  const sign = parsed < 0n ? '-' : '';
  const abs = parsed < 0n ? -parsed : parsed;

  if (abs < 1000n) return `${sign}${abs.toString()}`;

  for (const unit of COMPACT_UNITS) {
    if (abs < unit.value) continue;

    const whole = abs / unit.value;
    const remainder = abs % unit.value;
    const tenths = (remainder * 10n) / unit.value;
    return tenths === 0n
      ? `${sign}${whole.toString()}${unit.suffix}`
      : `${sign}${whole.toString()}.${tenths.toString()}${unit.suffix}`;
  }

  return `${sign}${abs.toString()}`;
}

function calculateLevel(points: bigint): number {
  return Math.max(1, toSafeNumber(points / 100n + 1n));
}

async function loadPoints(ctx?: StorageContext): Promise<PointsRecord> {
  return readJsonFile<PointsRecord>(POINTS_FILE, {}, ctx);
}

async function savePoints(data: PointsRecord, ctx?: StorageContext): Promise<void> {
  await writeJsonFile(POINTS_FILE, data, ctx);
}

function getDiscordOutputContext() {
  const output = getChatOutputContext();
  return output?.platform === 'discord' && output.userId ? output : null;
}

export async function getPoints(userId: string, ctx?: StorageContext): Promise<{ points: number; pointsRaw: string; pointsDisplay: string; level: number; totalEarned: number; totalEarnedRaw: string }> {
  const discordContext = getDiscordOutputContext();
  if (discordContext && !ctx) {
    const result = await getDiscordStreamHubPoints();
    const points = BigInt(Math.max(0, Math.trunc(Number(result.points || 0))));
    return {
      points: Number(points),
      pointsRaw: points.toString(),
      pointsDisplay: formatCompactPointAmount(points),
      level: calculateLevel(points),
      totalEarned: Number(points),
      totalEarnedRaw: points.toString(),
    };
  }

  const store = await loadPoints(ctx);
  const entry = store[userId.toLowerCase()];
  if (!entry) return { points: 0, pointsRaw: '0', pointsDisplay: '0', level: 1, totalEarned: 0, totalEarnedRaw: '0' };

  const points = normalizeStoredPointAmount(entry.points ?? 0);
  const totalEarned = normalizeStoredPointAmount(entry.totalEarned ?? 0);
  return {
    points: toSafeNumber(points),
    pointsRaw: points.toString(),
    pointsDisplay: formatCompactPointAmount(points),
    level: calculateLevel(points),
    totalEarned: toSafeNumber(totalEarned),
    totalEarnedRaw: totalEarned.toString(),
  };
}

export async function getPointBalance(userId: string, ctx?: StorageContext): Promise<bigint> {
  const discordContext = getDiscordOutputContext();
  if (discordContext && !ctx) {
    const result = await getDiscordStreamHubPoints();
    return BigInt(Math.max(0, Math.trunc(Number(result.points || 0))));
  }

  const store = await loadPoints(ctx);
  const entry = store[userId.toLowerCase()];
  return normalizeStoredPointAmount(entry?.points ?? 0);
}

/**
 * Applies a wager outcome. In Discord the canonical SPMT wallet settles it, so a
 * jackpot refills spendable XP up to the lifetime ceiling instead of writing a
 * new total straight into the leaderboard.
 */
export async function settleWager(
  userId: string,
  input: { wager: PointAmount; payout: PointAmount; newTotal: PointAmount; eventType?: string },
  ctx?: StorageContext,
): Promise<{ points: number; currentPoints: number; lifetimePoints: number }> {
  const discordContext = getDiscordOutputContext();
  if (discordContext && !ctx) {
    const settlement = await settleDiscordStreamHubGamble({
      wager: Number(parsePointAmount(input.wager)),
      payout: Number(parsePointAmount(input.payout)),
      idempotencyKey: `streamweaver:${discordContext.userId}:${randomUUID()}`,
      eventType: input.eventType || 'gamble',
      metadata: { surface: 'discord', command: input.eventType || 'gamble' },
    });
    return {
      points: settlement.points,
      currentPoints: settlement.currentPoints,
      lifetimePoints: settlement.lifetimePoints,
    };
  }

  const updated = await setPoints(userId, input.newTotal, ctx);
  return { points: updated.points, currentPoints: updated.points, lifetimePoints: updated.points };
}

export async function getAllUsers(ctx?: StorageContext): Promise<PointsRecord> {
  return loadPoints(ctx);
}

export async function addPointsToAll(amount: PointAmount, ctx?: StorageContext): Promise<number> {
  const discordContext = getDiscordOutputContext();
  if (discordContext && !ctx) {
    const delta = parsePointAmount(amount);
    const result = await addDiscordStreamHubPointsToAll({
      points: Number(delta),
      serverId: discordContext.guildId,
    });
    console.log(`DiscordStreamHub added ${formatCompactPointAmount(delta)} points to ${result.count} users`);
    return result.count;
  }

  const store = await loadPoints(ctx);
  const now = new Date().toISOString();
  const delta = parsePointAmount(amount);
  let count = 0;
  
  for (const key in store) {
    const current = store[key];
    const oldPoints = normalizeStoredPointAmount(current.points);
    const oldEarned = normalizeStoredPointAmount(current.totalEarned || 0);
    const newPoints = oldPoints + delta < 0n ? 0n : oldPoints + delta;
    const level = calculateLevel(newPoints);
    const totalEarned = oldEarned + (delta > 0n ? delta : 0n);
    
    store[key] = {
      points: newPoints.toString(),
      level,
      updatedAt: now,
      lastActivity: current.lastActivity,
      totalEarned: totalEarned.toString()
    };
    count++;
  }
  
  await savePoints(store, ctx);
  console.log(`Added ${formatCompactPointAmount(delta)} points to ${count} users`);
  return count;
}

export async function setPointsToAll(amount: PointAmount, ctx?: StorageContext): Promise<number> {
  const discordContext = getDiscordOutputContext();
  if (discordContext && !ctx) {
    const points = normalizePoints(amount);
    const result = await setDiscordStreamHubPointsToAll({
      points: Number(points),
      serverId: discordContext.guildId,
    });
    console.log(`DiscordStreamHub set ${result.count} users to ${formatCompactPointAmount(points)} points`);
    return result.count;
  }

  const store = await loadPoints(ctx);
  const now = new Date().toISOString();
  const points = normalizePoints(amount);
  const level = calculateLevel(points);
  let count = 0;
  
  for (const key in store) {
    const current = store[key];
    store[key] = {
      points: points.toString(),
      level,
      updatedAt: now,
      lastActivity: current.lastActivity,
      totalEarned: current.totalEarned
    };
    count++;
  }
  
  await savePoints(store, ctx);
  console.log(`Set ${count} users to ${formatCompactPointAmount(points)} points`);
  return count;
}

export async function resetAllPoints(ctx?: StorageContext): Promise<number> {
  const discordContext = getDiscordOutputContext();
  if (discordContext && !ctx) {
    const result = await setDiscordStreamHubPointsToAll({
      points: 0,
      serverId: discordContext.guildId,
    });
    console.log(`DiscordStreamHub reset points for ${result.count} users`);
    return result.count;
  }

  const store = await loadPoints(ctx);
  const now = new Date().toISOString();
  let count = 0;
  
  for (const key in store) {
    const current = store[key];
    store[key] = {
      points: '0',
      level: 1,
      updatedAt: now,
      lastActivity: current.lastActivity,
      totalEarned: current.totalEarned
    };
    count++;
  }
  
  await savePoints(store, ctx);
  console.log(`Reset points for ${count} users`);
  return count;
}

export async function addPoints(
  userId: string,
  amount: PointAmount,
  reason?: string,
  ctx?: StorageContext
): Promise<{ points: number; pointsRaw: string; pointsDisplay: string; level: number; totalEarned: number; totalEarnedRaw: string }> {
  const discordContext = getDiscordOutputContext();
  if (discordContext && !ctx) {
    const current = await getDiscordStreamHubPoints();
    const delta = parsePointAmount(amount);
    const next = current.points + Number(delta);
    const clamped = Math.max(0, Math.trunc(next));
    const updated = await setDiscordStreamHubPoints({
      userId: discordContext.userId!,
      username: discordContext.username || userId,
      displayName: discordContext.displayName || discordContext.username || userId,
      serverId: discordContext.guildId,
      points: clamped,
    });
    const points = BigInt(Math.max(0, Math.trunc(Number(updated.points || 0))));
    return {
      points: Number(points),
      pointsRaw: points.toString(),
      pointsDisplay: formatCompactPointAmount(points),
      level: calculateLevel(points),
      totalEarned: Number(points),
      totalEarnedRaw: points.toString(),
    };
  }

  const store = await loadPoints(ctx);
  const key = userId.toLowerCase();
  const now = new Date().toISOString();
  const current = store[key] ?? { points: '0', level: 1, updatedAt: now, lastActivity: now, totalEarned: '0' };
  const delta = parsePointAmount(amount);
  const currentPoints = normalizeStoredPointAmount(current.points);
  const currentEarned = normalizeStoredPointAmount(current.totalEarned || 0);
  const newPoints = currentPoints + delta < 0n ? 0n : currentPoints + delta;
  const level = calculateLevel(newPoints);
  const totalEarned = currentEarned + (delta > 0n ? delta : 0n);
  
  store[key] = { 
    points: newPoints.toString(), 
    level, 
    updatedAt: now, 
    lastActivity: now,
    totalEarned: totalEarned.toString()
  };
  
  await savePoints(store, ctx);
  console.log(`Points updated: ${userId} ${delta > 0n ? '+' : ''}${formatCompactPointAmount(delta)} (${reason || 'manual'}) -> ${formatCompactPointAmount(newPoints)} total`);
  return {
    points: toSafeNumber(newPoints),
    pointsRaw: newPoints.toString(),
    pointsDisplay: formatCompactPointAmount(newPoints),
    level,
    totalEarned: toSafeNumber(totalEarned),
    totalEarnedRaw: totalEarned.toString(),
  };
}

export async function setPoints(
  userId: string,
  value: PointAmount,
  ctx?: StorageContext
): Promise<{ points: number; pointsRaw: string; pointsDisplay: string; level: number; totalEarned: number; totalEarnedRaw: string }> {
  const discordContext = getDiscordOutputContext();
  if (discordContext && !ctx) {
    const normalized = normalizePoints(value);
    const updated = await setDiscordStreamHubPoints({
      userId: discordContext.userId!,
      username: discordContext.username || userId,
      displayName: discordContext.displayName || discordContext.username || userId,
      serverId: discordContext.guildId,
      points: Number(normalized),
    });
    const points = BigInt(Math.max(0, Math.trunc(Number(updated.points || 0))));
    return {
      points: Number(points),
      pointsRaw: points.toString(),
      pointsDisplay: formatCompactPointAmount(points),
      level: calculateLevel(points),
      totalEarned: Number(points),
      totalEarnedRaw: points.toString(),
    };
  }

  const store = await loadPoints(ctx);
  const key = userId.toLowerCase();
  const now = new Date().toISOString();
  const current = store[key] ?? { points: '0', level: 1, updatedAt: now, lastActivity: now, totalEarned: '0' };
  const points = normalizePoints(value);
  const level = calculateLevel(points);
  const totalEarned = normalizeStoredPointAmount(current.totalEarned || 0);
  
  store[key] = { 
    points: points.toString(), 
    level, 
    updatedAt: now, 
    lastActivity: current.lastActivity,
    totalEarned: current.totalEarned
  };
  
  await savePoints(store, ctx);
  return {
    points: toSafeNumber(points),
    pointsRaw: points.toString(),
    pointsDisplay: formatCompactPointAmount(points),
    level,
    totalEarned: toSafeNumber(totalEarned),
    totalEarnedRaw: totalEarned.toString(),
  };
}

export async function getLeaderboard(limit = 10, ctx?: StorageContext): Promise<Array<{ user: string; points: number; pointsRaw: string; pointsDisplay: string; level: number; totalEarned: number; totalEarnedRaw: string }>> {
  const store = await loadPoints(ctx);
  return Object.entries(store)
    .map(([user, data]) => {
      const points = normalizeStoredPointAmount(data.points);
      const totalEarned = normalizeStoredPointAmount(data.totalEarned || 0);
      return {
        user,
        points: toSafeNumber(points),
        pointsRaw: points.toString(),
        pointsDisplay: formatCompactPointAmount(points),
        level: calculateLevel(points),
        totalEarned: toSafeNumber(totalEarned),
        totalEarnedRaw: totalEarned.toString(),
      };
    })
    .sort((a, b) => {
      const left = parsePointAmount(a.pointsRaw);
      const right = parsePointAmount(b.pointsRaw);
      return left === right ? 0 : left > right ? -1 : 1;
    })
    .slice(0, limit);
}

// Award points for follows, subs, etc.
export async function awardEventPoints(userId: string, event: string, metadata?: any, ctx?: StorageContext): Promise<void> {
  const settings = await getPointSettings(ctx);
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
    await addPoints(userId, points, event, ctx);
  }
}

// Auto-award points for chat activity
export async function awardChatPoints(userId: string, ctx?: StorageContext): Promise<void> {
  const store = await loadPoints(ctx);
  const key = userId.toLowerCase();
  const now = new Date();
  const current = store[key];
  
  const settings = await getPointSettings(ctx);
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
  
  await addPoints(userId, points, 'chat activity', ctx);
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

export async function getPointSettings(ctx?: StorageContext): Promise<PointSettings> {
  return readJsonFile<PointSettings>(SETTINGS_FILE, defaultSettings, ctx);
}

export async function updatePointSettings(settings: Partial<PointSettings> & { eventPoints?: Partial<PointSettings['eventPoints']> }, ctx?: StorageContext): Promise<void> {
  const current = await getPointSettings(ctx);
  const updated = {
    ...current,
    ...settings,
    eventPoints: {
      ...current.eventPoints,
      ...(settings.eventPoints ?? {}),
    },
  };
  await writeJsonFile(SETTINGS_FILE, updated, ctx);
}

export async function getChannelPointRewards(ctx?: StorageContext): Promise<ChannelPointReward[]> {
  return readJsonFile<ChannelPointReward[]>(REWARDS_FILE, [
    { name: 'first', points: 100, message: 'Congrats on being first!' },
    { name: 'hydrate', points: -100, message: 'Stay hydrated! 💧' },
    { name: 'stretch', points: -100, message: 'Time to stretch! 🤸' }
  ], ctx);
}

export async function updateChannelPointRewards(rewards: ChannelPointReward[], ctx?: StorageContext): Promise<void> {
  await writeJsonFile(REWARDS_FILE, rewards, ctx);
}

export async function getUserPoints(userId: string, ctx?: StorageContext): Promise<number> {
  const data = await getPoints(userId, ctx);
  return data.points;
}

export async function updateUserPoints(userId: string, value: PointAmount, ctx?: StorageContext): Promise<void> {
  await setPoints(userId, value, ctx);
}

/**
 * Syncs points data and broadcasts updates to clients
 */
export async function syncPointsData(ctx?: StorageContext): Promise<void> {
  try {
    // Get current leaderboard
    const leaderboard = await getLeaderboard(10, ctx);
    
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
