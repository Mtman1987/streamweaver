import { handleDouble, handleRoll as handleClassicRoll } from './classic-gamble';
import type { PointAmount } from '../points';

const pendingWagers = new Map<string, string>();
const gambleModes = new Map<string, string>();

function tenantUserKey(user: string, tenantId: string): string {
  const tenant = String(tenantId || '').trim();
  if (!tenant) throw new Error('Gamble state requires tenant context');
  return tenant + ':' + user.toLowerCase();
}

export async function handleGambleMode(user: string, mode: string, tenantId: string): Promise<void> {
  gambleModes.set(tenantUserKey(user, tenantId), mode);
}

export async function handleRoll(user: string, wager: PointAmount, userPoints: PointAmount, tenantId: string) {
  const result = await handleClassicRoll(user, String(wager), userPoints, tenantId);
  if (result) {
    pendingWagers.set(tenantUserKey(user, tenantId), result.change.startsWith('-') ? result.change.slice(1) : result.change || String(wager));
  }
  return result;
}

export async function handleYes(user: string, userPoints: PointAmount, tenantId: string) {
  const key = tenantUserKey(user, tenantId);
  const wager = pendingWagers.get(key);
  if (!wager) {
    return null;
  }
  pendingWagers.delete(key);
  return handleDouble(user, wager, userPoints, tenantId);
}

export async function handleNo(user: string, tenantId: string) {
  pendingWagers.delete(tenantUserKey(user, tenantId));
}

export function getGambleMode(user: string, tenantId: string): string {
  return gambleModes.get(tenantUserKey(user, tenantId)) || 'classic';
}
