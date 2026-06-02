import { addPoints, formatCompactPointAmount, getPoints } from './points';
import { readJsonFile, writeJsonFile, StorageContext } from './storage';

const COOLDOWN_FILE = 'steal-cooldowns.json';
const STEAL_COOLDOWN_MS = 2 * 60 * 60 * 1000; // 2 hours
const MAX_STEAL_AMOUNT = 1_000_000;

type CooldownRecord = Record<string, number>;

async function loadCooldowns(ctx?: StorageContext): Promise<CooldownRecord> {
  return readJsonFile<CooldownRecord>(COOLDOWN_FILE, {}, ctx);
}

async function saveCooldowns(data: CooldownRecord, ctx?: StorageContext): Promise<void> {
  await writeJsonFile(COOLDOWN_FILE, data, ctx);
}

export async function givePoints(fromUser: string, toUser: string, amount: number, ctx?: StorageContext): Promise<{ success: boolean; message: string }> {
  const from = fromUser.toLowerCase();
  const to = toUser.toLowerCase();
  
  if (from === to) {
    return { success: false, message: `@${fromUser}, you can't give points to yourself!` };
  }
  
  if (amount <= 0) {
    return { success: false, message: `@${fromUser}, amount must be positive!` };
  }
  
  const fromPoints = await getPoints(from, ctx);
  
  if (fromPoints.points < amount) {
    return { success: false, message: `@${fromUser}, you only have ${fromPoints.points} points!` };
  }
  
  await addPoints(from, -amount, `gave to ${to}`, ctx);
  await addPoints(to, amount, `received from ${from}`, ctx);
  
  return { success: true, message: `@${fromUser} gave ${amount} points to @${toUser}! 💝` };
}

const HEIST_SCENARIOS = [
  {
    success: "slipped past the security lasers and grabbed the loot",
    fail: "triggered the alarm and had to flee empty-handed",
    partial: "grabbed what they could before the guards arrived"
  },
  {
    success: "hacked the vault and transferred the credits",
    fail: "got caught in the firewall and lost their connection",
    partial: "managed to grab some data before getting disconnected"
  },
  {
    success: "teleported in, snatched the goods, and vanished",
    fail: "miscalculated the coordinates and ended up in the wrong sector",
    partial: "grabbed a handful before the teleporter malfunctioned"
  },
  {
    success: "sweet-talked the AI guardian and walked away with everything",
    fail: "got outsmarted by the AI and ejected from the station",
    partial: "charmed their way to a small share before being escorted out"
  },
  {
    success: "used a cloaking device and cleaned out the vault",
    fail: "the cloak failed and they were spotted immediately",
    partial: "the cloak flickered, forcing a quick grab-and-run"
  }
];

export async function stealPoints(fromUser: string, toUser: string, amount: number, ctx?: StorageContext): Promise<{ success: boolean; message: string }> {
  const from = fromUser.toLowerCase();
  const to = toUser.toLowerCase();
  
  if (from === to) {
    return { success: false, message: `@${fromUser}, you can't steal from yourself!` };
  }
  
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    return { success: false, message: `@${fromUser}, amount must be positive!` };
  }

  if (amount > MAX_STEAL_AMOUNT) {
    return { success: false, message: `@${fromUser}, you can steal at most ${formatCompactPointAmount(MAX_STEAL_AMOUNT)} points at a time!` };
  }
  
  // Check cooldown
  const cooldowns = await loadCooldowns(ctx);
  const lastSteal = cooldowns[from] || 0;
  const now = Date.now();
  
  if (now - lastSteal < STEAL_COOLDOWN_MS) {
    const remaining = Math.ceil((STEAL_COOLDOWN_MS - (now - lastSteal)) / 60000);
    return { success: false, message: `@${fromUser}, you're on cooldown! Wait ${remaining} more minutes.` };
  }
  
  const fromPoints = await getPoints(from, ctx);
  if (fromPoints.points < amount) {
    return { success: false, message: `@${fromUser}, you can only risk points you already have. You have ${fromPoints.pointsDisplay} points!` };
  }

  const targetPoints = await getPoints(to, ctx);
  
  if (targetPoints.points < amount) {
    return { success: false, message: `@${fromUser}, @${toUser} only has ${targetPoints.pointsDisplay} points!` };
  }
  
  // RNG heist outcome
  const roll = Math.random() * 100;
  const scenario = HEIST_SCENARIOS[Math.floor(Math.random() * HEIST_SCENARIOS.length)];
  
  let outcome: string;
  let pointsStolen: number;
  let message: string;
  
  if (roll < 25) {
    // Success - get full amount
    outcome = scenario.success;
    pointsStolen = amount;
    await addPoints(to, -amount, `stolen by ${from}`, ctx);
    await addPoints(from, amount, `stolen from ${to}`, ctx);
    message = `@${fromUser} ${outcome}! Stole ${formatCompactPointAmount(pointsStolen)} points from @${toUser}! 💰`;
  } else if (roll < 55) {
    // Partial - get half
    outcome = scenario.partial;
    pointsStolen = Math.floor(amount / 2);
    await addPoints(to, -pointsStolen, `stolen by ${from}`, ctx);
    await addPoints(from, pointsStolen, `stolen from ${to}`, ctx);
    message = `@${fromUser} ${outcome}! Got ${formatCompactPointAmount(pointsStolen)} points from @${toUser}! 💸`;
  } else if (roll < 80) {
    // Fail - get nothing
    outcome = scenario.fail;
    message = `@${fromUser} ${outcome}! No points stolen. 😅`;
  } else if (roll < 95) {
    // Critical fail - lose the amount
    outcome = scenario.fail;
    const penalty = Math.min(amount, fromPoints.points);
    if (penalty > 0) {
      await addPoints(from, -penalty, 'heist backfired', ctx);
    }
    message = `@${fromUser} ${outcome}! Lost ${formatCompactPointAmount(penalty)} points in the attempt! 💥`;
  } else {
    // Catastrophic fail - lose the staked amount. Never risk more than the steal amount.
    outcome = scenario.fail;
    const penalty = Math.min(amount, fromPoints.points);
    if (penalty > 0) {
      await addPoints(from, -penalty, 'heist catastrophe', ctx);
    }
    message = `@${fromUser} ${outcome}! Lost ${formatCompactPointAmount(penalty)} points in the catastrophic failure! 💀`;
  }
  
  // Set cooldown
  cooldowns[from] = now;
  await saveCooldowns(cooldowns, ctx);
  
  return { success: true, message };
}
