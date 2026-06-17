import { readUserConfigSync } from '@/lib/user-config';
import { getStoredTokens } from '@/lib/token-utils.server';

const DEFAULT_DISCORD_AVATAR = 'https://cdn.discordapp.com/embed/avatars/0.png';
const avatarCache = new Map<string, { url: string; expiresAt: number }>();

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return '';
}

function firstUrl(...values: unknown[]): string {
  for (const value of values) {
    const text = firstString(value);
    if (/^https?:\/\//i.test(text)) return text;
  }
  return '';
}

export async function getAvatarUrlForTenant(tenantId?: string): Promise<string> {
  const cacheKey = tenantId || 'global';
  const cached = avatarCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.url;

  let avatarUrl = '';
  const config = readUserConfigSync(tenantId);
  const tokens = (await getStoredTokens(tenantId).catch(() => null)) as Record<string, any> | null;

  avatarUrl = firstUrl(
    tokens?.botAvatarUrl,
    tokens?.botProfileImageUrl,
    tokens?.botProfileImage,
    config.TWITCH_BOT_AVATAR_URL,
    config.TWITCH_BOT_PROFILE_IMAGE_URL,
    config.BOT_AVATAR_URL,
    tokens?.broadcasterAvatarUrl,
    tokens?.broadcasterProfileImageUrl,
    tokens?.loginAvatarUrl,
    tokens?.loginProfileImageUrl,
    config.TWITCH_BROADCASTER_AVATAR_URL
  );

  const resolved = avatarUrl || DEFAULT_DISCORD_AVATAR;
  avatarCache.set(cacheKey, { url: resolved, expiresAt: Date.now() + 60 * 60 * 1000 });
  return resolved;
}
