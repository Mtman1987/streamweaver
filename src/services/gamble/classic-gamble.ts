// ╔═══════════════════════════════════════════════════════════════════════╗
// ║  🎰 CLASSIC CHAT GAMBLE - STREAMWEAVER EDITION                       ║
// ║  Commands: !gamble <amount>, !gamble settings                        ║
// ║  Supports: all/half/quarter/third/random bet amounts                 ║
// ╚═══════════════════════════════════════════════════════════════════════╝

import * as fs from 'fs/promises';
import * as path from 'path';
import { randomBytes } from 'crypto';
import { sendChatMessage } from '../twitch';
import { formatCompactPointAmount, parsePointAmount, PointAmount } from '../points';

// ════════════════════════════════════════════════
// 🛠️ SETTINGS
// ════════════════════════════════════════════════
interface GambleSettings {
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
  jackpotPercent: 3,
  jackpotMultiplier: 43,
  winPercent: 38,
  blockedGroups: '',
  numberSeparator: ',',
  useOverlay: true,
  overlayScene: 'Gamble Alerts',
  overlaySource: 'gamble-overlay',
  overlayDisplayMs: 5000
};

const SETTINGS_PATH = path.resolve(process.env.PERSIST_ROOT || path.join(process.cwd(), 'data', 'runtime'), 'global', 'gamble-settings.json');
const DEFAULT_MAX_BET = '1000000000000000000000';

let settings: GambleSettings = { ...DEFAULT_SETTINGS };

// ════════════════════════════════════════════════
// 📊 SETTINGS MANAGEMENT
// ════════════════════════════════════════════════
async function loadSettings(): Promise<void> {
  try {
    await fs.mkdir(path.dirname(SETTINGS_PATH), { recursive: true });
    const data = await fs.readFile(SETTINGS_PATH, 'utf-8');
    settings = { ...DEFAULT_SETTINGS, ...JSON.parse(data) };
    console.log('[ClassicGamble] Settings loaded');
  } catch {
    await saveSettings();
    console.log('[ClassicGamble] Created default settings');
  }
}

async function saveSettings(): Promise<void> {
  try {
    await fs.mkdir(path.dirname(SETTINGS_PATH), { recursive: true });
    await fs.writeFile(SETTINGS_PATH, JSON.stringify(settings, null, 2));
    console.log('[ClassicGamble] Settings saved');
  } catch (error) {
    console.error('[ClassicGamble] Failed to save settings:', error);
  }
}

export async function updateSettings(newSettings: Partial<GambleSettings>): Promise<void> {
  settings = { ...settings, ...newSettings };
  await saveSettings();
}

export function getSettings(): GambleSettings {
  return { ...settings };
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
  change: string;
  newTotal: string;
  changeDisplay: string;
  newTotalDisplay: string;
  canDouble: boolean;
}

interface DoubleResult {
  roll: number;
  won: boolean;
  change: string;
  newTotal: string;
  changeDisplay: string;
  newTotalDisplay: string;
}

function determineOutcome(betAmount: bigint): { outcome: GambleOutcome; change: bigint } {
  const jp = Math.max(1, settings.jackpotPercent);
  let wp = Math.max(1, settings.winPercent);
  if (wp < jp) wp = jp;
  if (wp >= 100) wp = 99;
  
  const jm = Math.max(1, settings.jackpotMultiplier);
  const roll = Math.floor(Math.random() * 100) + 1;
  
  if (roll <= jp) {
    // Jackpot
    const winPercent = BigInt(Math.floor(150 + Math.random() * 100));
    const change = (betAmount * winPercent * BigInt(jm)) / 100n;
    return { outcome: GambleOutcome.Jackpot, change };
  } else if (roll <= wp) {
    // Win
    const winPercent = BigInt(Math.floor(150 + Math.random() * 100));
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
      return { outcome: 'Partial win!', change: betAmount / 2n };
    case 5:
      return { outcome: 'Nice win!', change: betAmount };
    case 6:
      return { outcome: 'JACKPOT! Double win!', change: betAmount * 2n };
    default:
      return { outcome: 'Error', change: 0n };
  }
}

function formatNumber(value: PointAmount): string {
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

function parseBetAmount(input: string, currentPoints: PointAmount): bigint | null {
  const upper = input.toUpperCase();
  const maxBet = getEffectiveMaxBet(currentPoints);
  
  if (upper === 'ALL') return maxBet;
  const points = parsePointAmount(currentPoints);
  if (upper === 'HALF') return points / 2n < maxBet ? points / 2n : maxBet;
  if (upper === 'QUARTER') return points / 4n < maxBet ? points / 4n : maxBet;
  if (upper === 'THIRD') return points / 3n < maxBet ? points / 3n : maxBet;
  if (upper === 'RANDOM') return maxBet > 0n ? randomBigInt(maxBet - 1n) + 1n : null;
  
  return parseNumericBet(input);
}

function getEffectiveMaxBet(currentPoints: PointAmount): bigint {
  const configuredMax = parsePointAmount(settings.maxBet) > 0n ? parsePointAmount(settings.maxBet) : parsePointAmount(DEFAULT_MAX_BET);
  const points = parsePointAmount(currentPoints);
  return points < configuredMax ? points : configuredMax;
}

async function sendOutput(user: string, message: string, tenantId?: string): Promise<void> {
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
  await loadSettings();
  const currentPoints = parsePointAmount(userPoints);
  
  // Determine bet amount
  let betAmount: bigint | null;
  
  if (!betInput || betInput.trim() === '') {
    if (parsePointAmount(settings.defaultBet) > 0n) {
      betAmount = parsePointAmount(settings.defaultBet);
    } else {
      await sendOutput(user, `please specify a valid bet amount or set DefaultBet > 0.`, tenantId);
      return null;
    }
  } else {
    betAmount = parseBetAmount(betInput, userPoints);
    
    if (betAmount === null) {
      await sendOutput(user, `invalid bet! Use numbers, 10^21, k/m/b/t/q/quintillion/sextillion suffixes, plus all/half/quarter/third/random.`, tenantId);
      return null;
    }
  }
  
  // Validate bet
  if (betAmount <= 0n && currentPoints > 0n) {
    await sendOutput(user, `you must bet a positive amount.`, tenantId);
    return null;
  }
  
  if (betAmount > currentPoints) {
    await sendOutput(user, `you can't bet ${formatNumber(betAmount)} ${settings.currencyName}! You only have ${formatNumber(currentPoints)}.`, tenantId);
    return null;
  }

  const effectiveMaxBet = getEffectiveMaxBet(userPoints);
  if (betAmount > effectiveMaxBet) {
    await sendOutput(user, `you can bet at most ${formatNumber(effectiveMaxBet)} ${settings.currencyName}.`, tenantId);
    return null;
  }
  
  if (parsePointAmount(settings.minBet) > 0n && betAmount < parsePointAmount(settings.minBet)) {
    await sendOutput(user, `you must bet at least ${formatNumber(settings.minBet)} ${settings.currencyName}.`, tenantId);
    return null;
  }
  
  // Process gamble
  const { outcome, change } = determineOutcome(betAmount);
  const newTotal = currentPoints + change < 0n ? 0n : currentPoints + change;
  const rawDisplayAmount = outcome === GambleOutcome.Loss ? betAmount : change;
  const displayAmount = rawDisplayAmount < 0n ? -rawDisplayAmount : rawDisplayAmount;
  
  const result: GambleResult = {
    outcome,
    betAmount: betAmount.toString(),
    change: change.toString(),
    newTotal: newTotal.toString(),
    displayAmount: displayAmount.toString(),
    betAmountDisplay: formatNumber(betAmount),
    changeDisplay: `${change > 0n ? '+' : ''}${formatNumber(change)}`,
    newTotalDisplay: formatNumber(newTotal),
    displayAmountDisplay: formatNumber(displayAmount)
  };
  
  // Check gamble mode
  const { getMode } = await import('../modes-manager');
  const gambleMode = await getMode('gamblemode', normalizeTenantId(tenantId));
  
  // Send result message in chat mode
  if (gambleMode === 'chat') {
    await sendResultMessage(user, result, tenantId);
  }
  
  // Send to overlay in overlay mode
  if (gambleMode === 'overlay') {
    await sendGambleToOverlay(user, result, tenantId);
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
  await loadSettings();
  const currentPoints = parsePointAmount(userPoints);
  
  const betAmount = parseNumericBet(betInput);
  if (betAmount === null || betAmount <= 0n) {
    await sendOutput(user, `usage: !roll <amount>`, tenantId);
    return null;
  }
  
  if (betAmount > currentPoints) {
    await sendOutput(user, `you don't have enough points! You have ${formatNumber(currentPoints)}.`, tenantId);
    return null;
  }
  
  const roll = Math.floor(Math.random() * 6) + 1;
  const { outcome, change } = determineRollOutcome(roll, betAmount);
  const newTotal = currentPoints + change < 0n ? 0n : currentPoints + change;
  
  const result: RollResult = {
    roll,
    outcome,
    change: change.toString(),
    newTotal: newTotal.toString(),
    changeDisplay: `${change > 0n ? '+' : ''}${formatNumber(change)}`,
    newTotalDisplay: formatNumber(newTotal),
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
    await sendRollToOverlay(user, result, tenantId);
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
  await loadSettings();
  const currentPoints = parsePointAmount(userPoints);
  const wagerAmount = parsePointAmount(wager);
  
  const doubleWager = wagerAmount * 2n;
  if (doubleWager > currentPoints) {
    await sendOutput(user, `you don't have enough points for double-or-nothing! Need ${formatNumber(doubleWager)}, have ${formatNumber(currentPoints)}.`, tenantId);
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
    change: change.toString(),
    newTotal: newTotal.toString(),
    changeDisplay: `${change > 0n ? '+' : ''}${formatNumber(change)}`,
    newTotalDisplay: formatNumber(newTotal)
  };
  
  // Check gamble mode - overlay or chat
  const { getMode } = await import('../modes-manager');
  const gambleMode = await getMode('gamblemode', normalizeTenantId(tenantId));
  
  // Send result message in chat mode
  if (gambleMode === 'chat') {
    const message = won 
      ? `@${user} rolled ${roll}! DOUBLE OR NOTHING WIN! +${formatNumber(doubleWager)} points! New total: ${formatNumber(newTotal)}`
      : `@${user} rolled ${roll}! Double or nothing failed. -${formatNumber(doubleWager)} points. New total: ${formatNumber(newTotal)}`;
    
    await sendChatMessage(message, settings.useBot ? 'bot' : 'broadcaster', undefined, tenantId);
  }
  
// Send to overlay if enabled
  if (gambleMode === 'overlay') {
    await sendDoubleToOverlay(user, result, wagerAmount.toString(), tenantId);
  }
  
  console.log(`[ClassicGamble] ${user} double ${roll}: ${won ? 'WIN' : 'LOSS'} ${change > 0n ? '+' : ''}${change} (new: ${newTotal}) (mode: ${gambleMode})`);
  
  return result;
}

// ════════════════════════════════════════════════
// 📡 OUTPUT
// ════════════════════════════════════════════════
async function sendResultMessage(user: string, result: GambleResult, tenantId?: string): Promise<void> {
  const { outcome, displayAmount, newTotal } = result;
  
  let message: string;
  const suffix = ` New Total: ${formatNumber(newTotal)} ${settings.currencyName}`;
  
  switch (outcome) {
    case GambleOutcome.Jackpot:
      message = `PowerUpL J A C K P O T PowerUpR @${user}, you hit the jackpot! You won ${formatNumber(displayAmount)} ${settings.currencyName}!${suffix}`;
      break;
    case GambleOutcome.Win:
      message = `@${user}, nice win! You got ${formatNumber(displayAmount)} ${settings.currencyName}! PopNemo${suffix}`;
      break;
    case GambleOutcome.Loss:
      message = `@${user}, unlucky! You lost ${formatNumber(displayAmount)} ${settings.currencyName}. FailFish Remaining: ${formatNumber(newTotal)} ${settings.currencyName}`;
      break;
  }
  
  await sendChatMessage(message, settings.useBot ? 'bot' : 'broadcaster', undefined, tenantId);
}

async function sendRollToOverlay(user: string, result: RollResult, tenantId?: string): Promise<void> {
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

async function sendDoubleToOverlay(user: string, result: DoubleResult, wager: string, tenantId?: string): Promise<void> {
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

async function sendGambleToOverlay(user: string, result: GambleResult, tenantId?: string): Promise<void> {
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

// Initialize settings on module load
loadSettings().catch(console.error);
