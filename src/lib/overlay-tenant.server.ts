import { listTenants } from '@/lib/tenant';
import { getStoredTokens } from '@/lib/token-utils.server';
import { readUserConfigSync } from '@/lib/user-config';

type CachedAlias = { tenantId: string; expiresAt: number };

const aliasCache = new Map<string, CachedAlias>();
const CACHE_TTL_MS = 60_000;

function normalize(value: unknown): string {
  return String(value || '').trim();
}

function aliasKey(value: string): string {
  return value.replace(/^user_/i, '').trim().toLowerCase();
}

function remember(alias: string, tenantId: string): string {
  aliasCache.set(aliasKey(alias), { tenantId, expiresAt: Date.now() + CACHE_TTL_MS });
  return tenantId;
}

export async function resolveOverlayTenantId(value: unknown): Promise<string | undefined> {
  const raw = normalize(value);
  if (!raw) return undefined;

  const key = aliasKey(raw);
  const cached = aliasCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.tenantId;
  if (cached) aliasCache.delete(key);

  const tenantIds = await listTenants();

  for (const tenantId of tenantIds) {
    if (aliasKey(tenantId) === key) return remember(raw, tenantId);
  }

  for (const tenantId of tenantIds) {
    const tokens = await getStoredTokens(tenantId);
    const config = readUserConfigSync(tenantId);
    const aliases = [
      tokens?.broadcasterUsername,
      tokens?.loginUsername,
      config.TWITCH_BROADCASTER_USERNAME,
    ]
      .map(normalize)
      .filter(Boolean);

    if (aliases.some((alias) => aliasKey(alias) === key)) {
      remember(tenantId, tenantId);
      for (const alias of aliases) remember(alias, tenantId);
      return remember(raw, tenantId);
    }
  }

  // Discord-only/SPMT-only tenants can legitimately use a non-Twitch ID. Keep
  // unknown values intact rather than breaking those overlays.
  return remember(raw, raw);
}
