// ╔═══════════════════════════════════════════════════════════════════════╗
// ║  🎰 CLASSIC CHAT GAMBLE - STREAMWEAVER EDITION                       ║
// ║  Commands: !gamble <amount>, !gamble settings                        ║
// ║  Supports: all/half/quarter/third/random bet amounts                 ║
// ╚═══════════════════════════════════════════════════════════════════════╝

import * as fs from 'fs/promises';
import * as path from 'path';
import { sendChatMessage } from '../twitch';
import { showOverlay } from '../overlay-manager';

// ════════════════════════════════════════════════
// 🛠️ SETTINGS
// ════════════════════════════════════════════════
interface GambleSettings {
  useBot: boolean;
  sendAction: boolean;
  pointsVariable: string;
  currencyName: string;
  defaultBet: number;
  minBet: number;
  maxBet: number;
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

const SETTINGS_PATH = path.resolve(process.cwd(), 'data', 'gamble-settings.json');

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
  betAmount: number;
  change: number;
  newTotal: number;
  displayAmount: number;
}

interface RollResult {
  roll: number;
  outcome: string;
  change: number;
  newTotal: number;
  canDouble: boolean;
}

interface DoubleResult {
  roll: number;
  won: boolean;
  change: number;
  newTotal: number;
}

function determineOutcome(betAmount: number): { outcome: GambleOutcome; change: number } {
  const jp = Math.max(1, settings.jackpotPercent);
  let wp = Math.max(1, settings.winPercent);
  if (wp < jp) wp = jp;
  if (wp >= 100) wp = 99;
  
  const jm = Math.max(1, settings.jackpotMultiplier);
  const roll = Math.floor(Math.random() * 100) + 1;
  
  if (roll <= jp) {
    // Jackpot
    const change = Math.floor(betAmount * (1.5 + Math.random()) * jm);
    return { outcome: GambleOutcome.Jackpot, change };
  } else if (roll <= wp) {
    // Win
    const change = Math.floor(betAmount * (1.5 + Math.random()));
    return { outcome: GambleOutcome.Win, change };
  } else {
    // Loss
    return { outcome: GambleOutcome.Loss, change: -betAmount };
  }
}

function determineRollOutcome(roll: number, betAmount: number): { outcome: string; change: number } {
  switch (roll) {
    case 1:
      return { outcome: 'Total loss!', change: -betAmount };
    case 2:
      return { outcome: 'Partial loss', change: Math.floor(-betAmount * 0.5) };
    case 3:
      return { outcome: 'Break even', change: 0 };
    case 4:
      return { outcome: 'Partial win!', change: Math.floor(betAmount * 0.5) };
    case 5:
      return { outcome: 'Nice win!', change: betAmount };
    case 6:
      return { outcome: 'JACKPOT! Double win!', change: betAmount * 2 };
    default:
      return { outcome: 'Error', change: 0 };
  }
}

function formatNumber(value: number): string {
  const sep = settings.numberSeparator || ',';
  return value.toLocaleString('en-US').replace(/,/g, sep);
}

function parseBetAmount(input: string, currentPoints: number): number {
  const upper = input.toUpperCase();
  
  if (upper === 'ALL') return currentPoints;
  if (upper === 'HALF') return Math.floor(currentPoints / 2);
  if (upper === 'QUARTER') return Math.floor(currentPoints / 4);
  if (upper === 'THIRD') return Math.floor(currentPoints / 3);
  if (upper === 'RANDOM') return Math.floor(Math.random() * currentPoints) + 1;
  
  const num = parseInt(input);
  return isNaN(num) ? -1 : num;
}

async function sendOutput(user: string, message: string): Promise<void> {
  await sendChatMessage(`❌ @${user}, ${message}`, settings.useBot ? 'bot' : 'broadcaster');
}

// ════════════════════════════════════════════════
// 🎮 MAIN HANDLERS
// ════════════════════════════════════════════════
export async function handleGamble(
  user: string,
  betInput: string,
  userPoints: number
): Promise<GambleResult | null> {
  await loadSettings();
  
  // Determine bet amount
  let betAmount: number;
  
  if (!betInput || betInput.trim() === '') {
    if (settings.defaultBet > 0) {
      betAmount = settings.defaultBet;
    } else {
      await sendOutput(user, `please specify a valid bet amount or set DefaultBet > 0.`);
      return null;
    }
  } else {
    betAmount = parseBetAmount(betInput, userPoints);
    
    if (betAmount < 0) {
      await sendOutput(user, `invalid bet! Use numbers/all/half/quarter/third/random.`);
      return null;
    }
  }
  
  // Validate bet
  if (betAmount <= 0 && userPoints > 0) {
    await sendOutput(user, `you must bet a positive amount.`);
    return null;
  }
  
  if (betAmount > userPoints) {
    await sendOutput(user, `you can't bet ${formatNumber(betAmount)} ${settings.currencyName}! You only have ${formatNumber(userPoints)}.`);
    return null;
  }
  
  if (settings.minBet > 0 && betAmount < settings.minBet) {
    await sendOutput(user, `you must bet at least ${formatNumber(settings.minBet)} ${settings.currencyName}.`);
    return null;
  }
  
  if (settings.maxBet > 0 && betAmount > settings.maxBet) {
    await sendOutput(user, `you can bet at most ${formatNumber(settings.maxBet)} ${settings.currencyName}.`);
    return null;
  }
  
  // Process gamble
  const { outcome, change } = determineOutcome(betAmount);
  const newTotal = Math.max(0, userPoints + change);
  const displayAmount = Math.abs(outcome === GambleOutcome.Loss ? betAmount : change);
  
  const result: GambleResult = {
    outcome,
    betAmount,
    change,
    newTotal,
    displayAmount
  };
  
  // Send result message only if chat output is enabled
  if (settings.useBot) {
    await sendResultMessage(user, result);
  }
  
  // Send to overlay if enabled
  if (settings.useOverlay) {
    await sendToOverlay(user, result);
  }
  
  console.log(`[ClassicGamble] ${user} ${outcome}: ${change > 0 ? '+' : ''}${change} (new: ${newTotal})`);
  
  return result;
}

export async function handleRoll(
  user: string,
  betInput: string,
  userPoints: number
): Promise<RollResult | null> {
  await loadSettings();
  
  const betAmount = parseInt(betInput);
  if (isNaN(betAmount) || betAmount <= 0) {
    await sendOutput(user, `usage: !roll <amount>`);
    return null;
  }
  
  if (betAmount > userPoints) {
    await sendOutput(user, `you don't have enough points! You have ${formatNumber(userPoints)}.`);
    return null;
  }
  
  const roll = Math.floor(Math.random() * 6) + 1;
  const { outcome, change } = determineRollOutcome(roll, betAmount);
  const newTotal = Math.max(0, userPoints + change);
  
  const result: RollResult = {
    roll,
    outcome,
    change,
    newTotal,
    canDouble: Math.abs(change) > 0 || betAmount > 0
  };
  
  // Send result message
  const message = `@${user} rolled a ${roll}! ${outcome} ${change >= 0 ? '+' : ''}${change} points. New total: ${formatNumber(newTotal)} | Type !double to double or nothing!`;
  await sendChatMessage(message, settings.useBot ? 'bot' : 'broadcaster');
  
  console.log(`[ClassicGamble] ${user} roll ${roll}: ${change > 0 ? '+' : ''}${change} (new: ${newTotal})`);
  
  return result;
}

export async function handleDouble(
  user: string,
  wager: number,
  userPoints: number
): Promise<DoubleResult | null> {
  await loadSettings();
  
  if (wager * 2 > userPoints) {
    await sendOutput(user, `you don't have enough points for double-or-nothing! Need ${formatNumber(wager * 2)}, have ${formatNumber(userPoints)}.`);
    return null;
  }
  
  const roll = Math.floor(Math.random() * 6) + 1;
  // Win on roll 6 only (16.7% chance - heavily house favored)
  const won = roll === 6;
  const change = won ? wager * 2 : -wager * 2;
  const newTotal = Math.max(0, userPoints + change);
  
  const result: DoubleResult = {
    roll,
    won,
    change,
    newTotal
  };
  
  const message = won 
    ? `@${user} rolled ${roll}! DOUBLE OR NOTHING WIN! +${formatNumber(wager * 2)} points! New total: ${formatNumber(newTotal)}`
    : `@${user} rolled ${roll}! Double or nothing failed. -${formatNumber(wager * 2)} points. New total: ${formatNumber(newTotal)}`;
  
  await sendChatMessage(message, settings.useBot ? 'bot' : 'broadcaster');
  
  console.log(`[ClassicGamble] ${user} double ${roll}: ${won ? 'WIN' : 'LOSS'} ${change > 0 ? '+' : ''}${change} (new: ${newTotal})`);
  
  return result;
}

// ════════════════════════════════════════════════
// 📡 OUTPUT
// ════════════════════════════════════════════════
async function sendResultMessage(user: string, result: GambleResult): Promise<void> {
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
  
  await sendChatMessage(message, settings.useBot ? 'bot' : 'broadcaster');
}

async function sendToOverlay(user: string, result: GambleResult): Promise<void> {
  try {
    // Write to shared gamble.json for unified overlay
    const overlayPath = path.resolve(process.cwd(), 'data', 'masterstats', 'overlay', 'gamble.json');
    await fs.mkdir(path.dirname(overlayPath), { recursive: true });
    
    const overlayData = {
      type: 'gamble',
      text: `${user} ${result.outcome === GambleOutcome.Jackpot ? 'JACKPOT!' : result.outcome === GambleOutcome.Win ? 'won!' : 'lost'}`,
      payload: {
        user,
        outcome: result.outcome,
        amount: result.displayAmount,
        newTotal: result.newTotal,
        currency: settings.currencyName,
        betAmount: result.betAmount,
        change: result.change,
        oldTotal: result.newTotal - result.change
      },
      timestamp: Date.now()
    };
    
    await fs.writeFile(overlayPath, JSON.stringify(overlayData, null, 2));
    
    // Trigger OBS overlay
    await showOverlay('gamble', overlayData);
  } catch (error) {
    console.error('[ClassicGamble] Overlay error:', error);
  }
}

// Initialize settings on module load
loadSettings().catch(console.error);