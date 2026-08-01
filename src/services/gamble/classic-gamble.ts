// ╔═══════════════════════════════════════════════════════════════════════╗
// ║  🎰 CLASSIC CHAT GAMBLE - STREAMWEAVER EDITION                       ║
// ║  Commands: !gamble <amount>, !gamble settings                        ║
// ║  Supports: all/half/quarter/third/random bet amounts                 ║
// ╚═══════════════════════════════════════════════════════════════════════╝

import * as fs from 'fs/promises';
import * as path from 'path';
import { randomBytes } from 'crypto';
import { tenantPath } from '@/lib/tenant';
import { sendChatMessage } from '../twitch';
import { formatCompactPointAmount, parsePointAmount, PointAmount } from '../points';

// ════════════════════════════════════════════════
// 🛠️ SETTINGS
// ════════════════════════════════════════════════
export interface GambleSettings {
  useBot: boolean;
  sendAction: boolean;
  pointsVariable: string;
  currencyName: string;
  defaultBet: number | string;
  minBet: number | string;
  maxBet: number | string;
  jackpotPercent: number;
  jackpotMultiplier: number;
  winPercent: number;
  blockedGroups: string;
  numberSeparator: string;
  // Overlay settings
  useOverlay: boolean;
  overlayScene: string;
  overlaySource: string;
  overlayDisplayMs: number;
}

const DEFAULT_SETTINGS: GambleSettings = {
  useBot: false,
  sendAction: false,
  pointsVariable: 'points',
  currencyName: 'Points',
  defaultBet: 1234,
  minBet: 0,
  maxBet: 0,
  jackpotPercent: 1,
  jackpotMultiplier: 1,
  winPercent: 28,
  blockedGroups: '',
  numberSeparator: ',',
  useOverlay: true,
  overlayScene: 'Gamble Alerts',
  overlaySource: 'gamble-overlay',
  overlayDisplayMs: 5000
};

const DEFAULT_MAX_BET = '1000000000000000000000';
const GLOBAL_JACKPOT_COOLDOWN_MS = 12 * 60 * 60 * 1000;

function globalJackpotStatePath(): string {
  return path.resolve(process.cwd(), 'data', 'global-gamble-jackpot.json');
}

async function claimGlobalJackpotSlot(): Promise<boolean> {
  const filePath = globalJackpotStatePath();
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  let lastJackpotAt = 0;
  try {
    const state = JSON.parse(await fs.readFile(filePath, 'utf-8'));
    lastJackpotAt = Number(state?.lastJackpotAt || 0);
  } catch {}
  const now = Date.now();
  if (lastJackpotAt > 0 && now - lastJackpotAt < GLOBAL_JACKPOT_COOLDOWN_MS) return false;
  const tempPath = filePath + '.tmp.' + process.pid + '.' + now;
  await fs.writeFile(tempPath, JSON.stringify({ lastJackpotAt: now }, null, 2));
  await fs.rename(tempPath, filePath);
  return true;
}
const settingsCache = new Map<string, GambleSettings>();

// ════════════════════════════════════════════════
// 📊 SETTINGS MANAGEMENT
// ════════════════════════════════════════════════
function settingsKey(tenantId?: string): string {
  return tenantId || '__development_global__';
}
function settingsPath(tenantId?: string): string {
  if (tenantId) return tenantPath(tenantId, 'data/gamble-settings.json');
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Classic gamble settings require tenant context');
  }
  return path.resolve(process.cwd(), 'data', 'gamble-settings.json');
}

async function loadSettings(tenantId?: string): Promise<GambleSettings> {
  const key = settingsKey(tenantId);
  const cached = settingsCache.get(key);
  if (cached) return cached;

  try {
    const filePath = settingsPath(tenantId);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const data = await fs.readFile(filePath, 'utf-8');
    const loaded = { ...DEFAULT_SETTINGS, ...JSON.parse(data) };
    settingsCache.set(key, loaded);
    console.log('[ClassicGamble] Settings loaded for ' + (tenantId || 'development'));
    return loaded;
  } catch {
    const defaults = { ...DEFAULT_SETTINGS };
    await saveSettings(defaults, tenantId);
    console.log('[ClassicGamble] Created default settings for ' + (tenantId || 'development'));
    return defaults;
  }
}

async function saveSettings(settings: GambleSettings, tenantId?: string): Promise<void> {
  try {
    const filePath = settingsPath(tenantId);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const tempPath = filePath + '.tmp.' + process.pid + '.' + Date.now();
    await fs.writeFile(tempPath, JSON.stringify(settings, null, 2));
    await fs.rename(tempPath, filePath);
    settingsCache.set(settingsKey(tenantId), settings);
    console.log('[ClassicGamble] Settings saved for ' + (tenantId || 'development'));
  } catch (error) {
    console.error('[ClassicGamble] Failed to save settings:', error);
    throw error;
  }
}

export async function updateSettings(newSettings: Partial<GambleSettings>, tenantId?: string): Promise<void> {
  const current = await loadSettings(tenantId);
  await saveSettings({ ...current, ...newSettings }, tenantId);
}

export async function getSettings(tenantId?: string): Promise<GambleSettings> {
  return { ...await loadSettings(tenantId) };
}

// ════════════════════════════════════════════════
// 🎲 GAME LOGIC
// ════════════════════════════════════════════════
enum GambleOutcome {
  Jackpot = 'jackpot',
  Win = 'win',
  Loss = 'loss'
}

interface GambleResult {
  outcome: GambleOutcome;
  betAmount: string;
  change: string;
  newTotal: string;
  displayAmount: string;
  betAmountDisplay: string;
  changeDisplay: string;
  newTotalDisplay: string;
  displayAmountDisplay: string;
}

interface RollResult {
  roll: number;
  outcome: string;
  betAmount: string;
  change: string;
  newTotal: string;
  changeDisplay: string;
  newTotalDisplay: string;
  canDouble: boolean;
}

interface DoubleResult {
  roll: number;
  won: boolean;
  betAmount: string;
  change: string;
  newTotal: string;
  changeDisplay: string;
  newTotalDisplay: string;
}

async function determineOutcome(betAmount: bigint, settings: GambleSettings): Promise<{ outcome: GambleOutcome; change: bigint }> {
  const jp = Math.max(1, settings.jackpotPercent);
  let wp = Math.max(1, settings.winPercent);
  if (wp < jp) wp = jp;
  if (wp >= 100) wp = 99;
  
  const jm = Math.max(1, settings.jackpotMultiplier);
  const roll = Math.floor(Math.random() * 100) + 1;
  
  if (roll <= jp && await claimGlobalJackpotSlot()) {
    // Community jackpot: at most one every 12 hours. Profit is 150-249% of wager.
    const winPercent = BigInt(Math.floor(150 + Math.random() * 100));
    const change = (betAmount * winPercent * BigInt(jm)) / 100n;
    return { outcome: GambleOutcome.Jackpot, change };
  } else if (roll <= wp) {
    // Normal profit is 25-75% of wager. A blocked jackpot roll becomes a normal win.
    const winPercent = BigInt(Math.floor(25 + Math.random() * 51));
    const change = (betAmount * winPercent) / 100n;
    return { outcome: GambleOutcome.Win, change };
  } else {
    // Loss
    return { outcome: GambleOutcome.Loss, change: -betAmount };
  }
}

function determineRollOutcome(roll: number, betAmount: bigint): { outcome: string; change: bigint } {
  switch (roll) {
    case 1:
      return { outcome: 'Total loss!', change: -betAmount };
    case 2:
      return { outcome: 'Partial loss', change: -(betAmount / 2n) };
    case 3:
      return { outcome: 'Break even', change: 0n };
    case 4:
      return { outcome: 'Small win!', change: betAmount / 4n };
    case 5:
      return { outcome: 'Nice win!', change: betAmount / 2n };
    case 6:
      return { outcome: 'Big win!', change: betAmount };
    default:
      return { outcome: 'Error', change: 0n };
  }
}

function formatNumber(value: PointAmount, settings: GambleSettings): string {
  const sep = settings.numberSeparator || ',';
  return formatCompactPointAmount(value).replace(/,/g, sep);
}

function parseNumericBet(input: string): bigint | null {
  try {
    const amount = parsePointAmount(input);
    return amount > 0n ? amount : null;
  } catch {
    return null;
  }
}

function randomBigInt(maxInclusive: bigint): bigint {
  if (maxInclusive <= 0n) return 0n;
  const bytes = Math.max(1, Math.ceil(maxInclusive.toString(2).length / 8));
  const maxExclusive = maxInclusive + 1n;

  for (let attempt = 0; attempt < 32; attempt += 1) {
    const value = BigInt(`0x${randomBytes(bytes).toString('hex')}`);
    const limit = (1n << BigInt(bytes * 8)) - ((1n << BigInt(bytes * 8)) % maxExclusive);
    if (value < limit) return value % maxExclusive;
  }

  return maxInclusive;
}

function parseBetAmount(input: string, currentPoints: PointAmount, settings: GambleSettings): bigint | null {
  const upper = input.toUpperCase();
  const maxBet = getEffectiveMaxBet(currentPoints, settings);
  
  if (upper === 'ALL') return maxBet;
  const points = parsePointAmount(currentPoints);
  if (upper === 'HALF') return points / 2n < maxBet ? points / 2n : maxBet;
  if (upper === 'QUARTER') return points / 4n < maxBet ? points / 4n : maxBet;
  if (upper === 'THIRD') return points / 3n < maxBet ? points / 3n : maxBet;
  if (upper === 'RANDOM') return maxBet > 0n ? randomBigInt(maxBet - 1n) + 1n : null;
  
  return parseNumericBet(input);
}

function getEffectiveMaxBet(currentPoints: PointAmount, settings: GambleSettings): bigint {
  const configuredMax = parsePointAmount(settings.maxBet) > 0n ? parsePointAmount(settings.maxBet) : parsePointAmount(DEFAULT_MAX_BET);
  const points = parsePointAmount(currentPoints);
  return points < configuredMax ? points : configuredMax;
}

async function sendOutput(user: string, message: string, settings: GambleSettings, tenantId?: string): Promise<void> {
  if (tenantId?.startsWith('__kick_silent__')) return;
  await sendChatMessage(`❌ @${user}, ${message}`, settings.useBot ? 'bot' : 'broadcaster', undefined, tenantId);
}

function normalizeTenantId(tenantId?: string): string | undefined {
  if (tenantId?.startsWith('__kick_silent__:')) return tenantId.slice('__kick_silent__:'.length);
  return tenantId;
}

// ════════════════════════════════════════════════
// 🎮 MAIN HANDLERS
// ════════════════════════════════════════════════
export async function handleGamble(
  user: string,
  betInput: string,
  userPoints: PointAmount,
  tenantId?: string
): Promise<GambleResult | null> {
  const settings = await loadSettings(normalizeTenantId(tenantId));
  const currentPoints = parsePointAmount(userPoints);
  
  // Determine bet amount
  let betAmount: bigint | null;
  
  if (!betInput || betInput.trim() === '') {
    if (parsePointAmount(settings.defaultBet) > 0n) {
      betAmount = parsePointAmount(settings.defaultBet);
    } else {
      await sendOutput(user, `please specify a valid bet amount or set DefaultBet > 0.`, settings, tenantId);
      return null;
    }
  } else {
    betAmount = parseBetAmount(betInput, userPoints, settings);
    
    if (betAmount === null) {
      await sendOutput(user, `invalid bet! Use numbers, 10^21, k/m/b/t/q/quintillion/sextillion suffixes, plus all/half/quarter/third/random.`, settings, tenantId);
      return null;
    }
  }
  
  // Validate bet
  if (betAmount <= 0n && currentPoints > 0n) {
    await sendOutput(user, `you must bet a positive amount.`, settings, tenantId);
    return null;
  }
  
  if (betAmount > currentPoints) {
    await sendOutput(user, `you can't bet ${formatNumber(betAmount, settings)} ${settings.currencyName}! You only have ${formatNumber(currentPoints, settings)}.`, settings, tenantId);
    return null;
  }

  const effectiveMaxBet = getEffectiveMaxBet(userPoints, settings);
  if (betAmount > effectiveMaxBet) {
    await sendOutput(user, `you can bet at most ${formatNumber(effectiveMaxBet, settings)} ${settings.currencyName}.`, settings, tenantId);
    return null;
  }
  
  if (parsePointAmount(settings.minBet) > 0n && betAmount < parsePointAmount(settings.minBet)) {
    await sendOutput(user, `you must bet at least ${formatNumber(settings.minBet, settings)} ${settings.currencyName}.`, settings, tenantId);
    return null;
  }
  
  // Process gamble
  const { outcome, change } = await determineOutcome(betAmount, settings);
  const newTotal = currentPoints + change < 0n ? 0n : currentPoints + change;
  const rawDisplayAmount = outcome === GambleOutcome.Loss ? betAmount : change;
  const displayAmount = rawDisplayAmount < 0n ? -rawDisplayAmount : rawDisplayAmount;
  
  const result: GambleResult = {
    outcome,
    betAmount: betAmount.toString(),
    change: change.toString(),
    newTotal: newTotal.toString(),
    displayAmount: displayAmount.toString(),
    betAmountDisplay: formatNumber(betAmount, settings),
    changeDisplay: `${change > 0n ? '+' : ''}${formatNumber(change, settings)}`,
    newTotalDisplay: formatNumber(newTotal, settings),
    displayAmountDisplay: formatNumber(displayAmount, settings)
  };
  
  // Check gamble mode
  const { getMode } = await import('../modes-manager');
  const gambleMode = await getMode('gamblemode', normalizeTenantId(tenantId));
  
  // Send result message in chat mode
  if (gambleMode === 'chat') {
    await sendResultMessage(user, result, settings, tenantId);
  }
  
  // Send to overlay in overlay mode
  if (gambleMode === 'overlay') {
    await sendGambleToOverlay(user, result, settings, tenantId);
  }
  
  console.log(`[ClassicGamble] ${user} ${outcome}: ${change > 0n ? '+' : ''}${change} (new: ${newTotal})`);
  
  return result;
}

export async function handleRoll(
  user: string,
  betInput: string,
  userPoints: PointAmount,
  tenantId?: string
): Promise<RollResult | null> {
  const settings = await loadSettings(normalizeTenantId(tenantId));
  const currentPoints = parsePointAmount(userPoints);
  
  const betAmount = parseNumericBet(betInput);
  if (betAmount === null || betAmount <= 0n) {
    await sendOutput(user, `usage: !roll <amount>`, settings, tenantId);
    return null;
  }
  
  if (betAmount > currentPoints) {
    await sendOutput(user, `you don't have enough points! You have ${formatNumber(currentPoints, settings)}.`, settings, tenantId);
    return null;
  }
  
  const roll = Math.floor(Math.random() * 6) + 1;
  const { outcome, change } = determineRollOutcome(roll, betAmount);
  const newTotal = currentPoints + change < 0n ? 0n : currentPoints + change;
  
  const result: RollResult = {
    roll,
    outcome,
    betAmount: betAmount.toString(),
    change: change.toString(),
    newTotal: newTotal.toString(),
    changeDisplay: `${change > 0n ? '+' : ''}${formatNumber(change, settings)}`,
    newTotalDisplay: formatNumber(newTotal, settings),
    canDouble: change !== 0n || betAmount > 0n
  };
  
  // Check gamble mode - overlay or chat
  const { getMode } = await import('../modes-manager');
  const gambleMode = await getMode('gamblemode', normalizeTenantId(tenantId));
  
  // Send result message in chat mode
  if (gambleMode === 'chat') {
    const message = `@${user} rolled a ${roll}! ${outcome} ${result.changeDisplay} points. New total: ${result.newTotalDisplay} | Type !double to double or nothing!`;
    await sendChatMessage(message, settings.useBot ? 'bot' : 'broadcaster', undefined, tenantId);
  }
  
// Send to overlay if enabled
  if (gambleMode === 'overlay') {
    await sendRollToOverlay(user, result, settings, tenantId);
  }
  
  console.log(`[ClassicGamble] ${user} roll ${roll}: ${change > 0n ? '+' : ''}${change} (new: ${newTotal}) (mode: ${gambleMode})`);
  
  return result;
}

export async function handleDouble(
  user: string,
  wager: PointAmount,
  userPoints: PointAmount,
  tenantId?: string
): Promise<DoubleResult | null> {
  const settings = await loadSettings(normalizeTenantId(tenantId));
  const currentPoints = parsePointAmount(userPoints);
  const wagerAmount = parsePointAmount(wager);
  
  const doubleWager = wagerAmount * 2n;
  if (doubleWager > currentPoints) {
    await sendOutput(user, `you don't have enough points for double-or-nothing! Need ${formatNumber(doubleWager, settings)}, have ${formatNumber(currentPoints, settings)}.`, settings, tenantId);
    return null;
  }
  
  const roll = Math.floor(Math.random() * 6) + 1;
  // Win on roll 6 only (16.7% chance - heavily house favored)
  const won = roll === 6;
  const change = won ? doubleWager : -doubleWager;
  const newTotal = currentPoints + change < 0n ? 0n : currentPoints + change;
  
  const result: DoubleResult = {
    roll,
    won,
    betAmount: doubleWager.toString(),
    change: change.toString(),
    newTotal: newTotal.toString(),
    changeDisplay: `${change > 0n ? '+' : ''}${formatNumber(change, settings)}`,
    newTotalDisplay: formatNumber(newTotal, settings)
  };
  
  // Check gamble mode - overlay or chat
  const { getMode } = await import('../modes-manager');
  const gambleMode = await getMode('gamblemode', normalizeTenantId(tenantId));
  
  // Send result message in chat mode
  if (gambleMode === 'chat') {
    const message = won 
      ? `@${user} rolled ${roll}! DOUBLE OR NOTHING WIN! +${formatNumber(doubleWager, settings)} points! New total: ${formatNumber(newTotal, settings)}`
      : `@${user} rolled ${roll}! Double or nothing failed. -${formatNumber(doubleWager, settings)} points. New total: ${formatNumber(newTotal, settings)}`;
    
    await sendChatMessage(message, settings.useBot ? 'bot' : 'broadcaster', undefined, tenantId);
  }
  
// Send to overlay if enabled
  if (gambleMode === 'overlay') {
    await sendDoubleToOverlay(user, result, wagerAmount.toString(), settings, tenantId);
  }
  
  console.log(`[ClassicGamble] ${user} double ${roll}: ${won ? 'WIN' : 'LOSS'} ${change > 0n ? '+' : ''}${change} (new: ${newTotal}) (mode: ${gambleMode})`);
  
  return result;
}

// ════════════════════════════════════════════════
// 📡 OUTPUT
// ════════════════════════════════════════════════
async function sendResultMessage(user: string, result: GambleResult, settings: GambleSettings, tenantId?: string): Promise<void> {
  const { outcome, displayAmount, newTotal } = result;
  
  let message: string;
  const suffix = ` New Total: ${formatNumber(newTotal, settings)} ${settings.currencyName}`;
  
  switch (outcome) {
    case GambleOutcome.Jackpot:
      message = `PowerUpL J A C K P O T PowerUpR @${user}, you hit the jackpot! You won ${formatNumber(displayAmount, settings)} ${settings.currencyName}!${suffix}`;
      break;
    case GambleOutcome.Win:
      message = `@${user}, nice win! You got ${formatNumber(displayAmount, settings)} ${settings.currencyName}! PopNemo${suffix}`;
      break;
    case GambleOutcome.Loss:
      message = `@${user}, unlucky! You lost ${formatNumber(displayAmount, settings)} ${settings.currencyName}. FailFish Remaining: ${formatNumber(newTotal, settings)} ${settings.currencyName}`;
      break;
  }
  
  await sendChatMessage(message, settings.useBot ? 'bot' : 'broadcaster', undefined, tenantId);
}

async function sendRollToOverlay(user: string, result: RollResult, settings: GambleSettings, tenantId?: string): Promise<void> {
  try {
    const overlayData = {
      type: 'roll',
      text: `${user} rolled a ${result.roll}! ${result.outcome}`,
      payload: {
        user,
        roll: result.roll,
        outcome: result.outcome,
        change: result.change,
        changeDisplay: result.changeDisplay,
        newTotal: result.newTotal,
        newTotalDisplay: result.newTotalDisplay,
        currency: settings.currencyName
      },
      timestamp: Date.now()
    };

    // Broadcast via WebSocket for overlay
    if (typeof (global as any).broadcast === 'function') {
      (global as any).broadcast({ type: 'roll-result', payload: overlayData }, normalizeTenantId(tenantId));
    }
  } catch (error) {
    console.error('[ClassicGamble] Roll overlay error:', error);
  }
}

async function sendDoubleToOverlay(user: string, result: DoubleResult, wager: string, settings: GambleSettings, tenantId?: string): Promise<void> {
  try {
    const overlayData = {
      type: 'double',
      text: `${user} double-or-nothing ${result.won ? 'WIN!' : 'FAIL!'}`,
      payload: {
        user,
        roll: result.roll,
        won: result.won,
        wager,
        change: result.change,
        changeDisplay: result.changeDisplay,
        newTotal: result.newTotal,
        newTotalDisplay: result.newTotalDisplay,
        currency: settings.currencyName
      },
      timestamp: Date.now()
    };

    // Broadcast via WebSocket for overlay
    if (typeof (global as any).broadcast === 'function') {
      (global as any).broadcast({ type: 'double-result', payload: overlayData }, normalizeTenantId(tenantId));
    }
  } catch (error) {
    console.error('[ClassicGamble] Double overlay error:', error);
  }
}

async function sendGambleToOverlay(user: string, result: GambleResult, settings: GambleSettings, tenantId?: string): Promise<void> {
  try {
    const overlayData = {
      type: 'gamble',
      text: `${user} ${result.outcome}!`,
      payload: {
        user,
        outcome: result.outcome,
        betAmount: result.betAmount,
        change: result.change,
        changeDisplay: result.changeDisplay,
        newTotal: result.newTotal,
        newTotalDisplay: result.newTotalDisplay,
        displayAmount: result.displayAmount,
        displayAmountDisplay: result.displayAmountDisplay,
        amount: result.displayAmount,
        currency: settings.currencyName
      },
      timestamp: Date.now()
    };

    if (typeof (global as any).broadcast === 'function') {
      (global as any).broadcast({ type: 'gamble-result', payload: overlayData }, normalizeTenantId(tenantId));
    }
  } catch (error) {
    console.error('[ClassicGamble] Gamble overlay error:', error);
  }
}
