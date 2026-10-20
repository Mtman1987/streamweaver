import { readUserConfigSync } from '@/lib/user-config';
import { getStoredTokens } from '@/lib/token-utils.server';

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

  // A persona's own saved avatar wins when StreamWeaverbot is speaking as that persona.
  // Keep the StreamWeaver / Twitch bot identity as fallback for personas without one.
  avatarUrl = firstUrl(
    config.AI_BOT_AVATAR_URL,
    config.AI_BOT_IDLE_AVATAR_URL,
    config.PUBLIC_DISCORD_GIF_URL,
    config.PUBLIC_AVATAR_URL,
    tokens?.botAvatarUrl,
    tokens?.botProfileImageUrl,
    tokens?.botProfileImage,
    config.TWITCH_BOT_AVATAR_GIF_URL,
    config.TWITCH_BOT_AVATAR_URL,
    config.TWITCH_BOT_PROFILE_IMAGE_URL,
    config.BOT_AVATAR_URL
  );

  avatarCache.set(cacheKey, { url: avatarUrl, expiresAt: Date.now() + 60 * 60 * 1000 });
  return avatarUrl;
}
