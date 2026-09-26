import type { StorageContext } from './storage';

export function getPointsWalletContext(tenantId?: string, chatChannel?: string, tokenUsername?: string): StorageContext | undefined {
  if (!tenantId) return undefined;
  const username = String(chatChannel || tokenUsername || (/^[a-z][a-z0-9_]{2,24}$/i.test(tenantId) ? tenantId : '')).trim().toLowerCase();
  if (!username) throw new Error(`Cannot resolve points wallet for tenant ${tenantId}`);
  return { tenantId, username };
}
