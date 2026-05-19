import { handleDouble, handleRoll as handleClassicRoll } from './classic-gamble';
import type { PointAmount } from '../points';

const pendingWagers = new Map<string, string>();
const gambleModes = new Map<string, string>();

export async function handleGambleMode(user: string, mode: string): Promise<void> {
  gambleModes.set(user.toLowerCase(), mode);
}

export async function handleRoll(user: string, wager: PointAmount, userPoints: PointAmount) {
  const result = await handleClassicRoll(user, String(wager), userPoints);
  if (result) {
    pendingWagers.set(user.toLowerCase(), result.change.startsWith('-') ? result.change.slice(1) : result.change || String(wager));
  }
  return result;
}

export async function handleYes(user: string, userPoints: PointAmount) {
  const key = user.toLowerCase();
  const wager = pendingWagers.get(key);
  if (!wager) {
    return null;
  }
  pendingWagers.delete(key);
  return handleDouble(user, wager, userPoints);
}

export async function handleNo(user: string) {
  pendingWagers.delete(user.toLowerCase());
}

export function getGambleMode(user: string): string {
  return gambleModes.get(user.toLowerCase()) || 'classic';
}
