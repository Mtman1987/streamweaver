import { handleDouble, handleRoll as handleClassicRoll } from './classic-gamble';

const pendingWagers = new Map<string, number>();
const gambleModes = new Map<string, string>();

export async function handleGambleMode(user: string, mode: string): Promise<void> {
  gambleModes.set(user.toLowerCase(), mode);
}

export async function handleRoll(user: string, wager: number, userPoints: number) {
  const result = await handleClassicRoll(user, String(wager), userPoints);
  if (result) {
    pendingWagers.set(user.toLowerCase(), Math.max(1, Math.abs(result.change) || wager));
  }
  return result;
}

export async function handleYes(user: string, userPoints: number) {
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