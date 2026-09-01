import { NextRequest } from 'next/server';
import { apiError, apiOk } from '@/lib/api-response';
import { bootstrapTenant, listTenants } from '@/lib/tenant';
import { getBotSettings } from '@/lib/bot-settings-store';
import { readUserConfigSync } from '@/lib/user-config';
import { ATHENA_CANONICAL_TTS_VOICE, ATHENA_TENANT_ID, getTtsVoiceOption } from '@/lib/tts-voices';
import { isTheCountName, isTheCountTwitchLogin } from '@/lib/the-count';

const SPMT_BASE_URL = String(process.env.SPMT_BASE_URL || 'https://spmt.live').replace(/\/$/, '');

type SpmtUser = {
  id: string;
  username: string;
  displayName?: string;
  display_name?: string;
  twitchId?: string;
  twitch_id?: string;
  twitchUsername?: string;
  twitch_username?: string;
};

function bearerToken(request: NextRequest): string {
  const header = String(request.headers.get('authorization') || '').trim();
  return /^Bearer\s+/i.test(header) ? header.replace(/^Bearer\s+/i, '').trim() : '';
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    const normalized = String(value || '').trim();
    if (normalized) return normalized;
  }
  return '';
}

function splitAliases(value: string): string[] {
  return Array.from(new Set(
    String(value || '')
      .split(/[\n,;|]+/)
      .map((entry) => entry.trim())
      .filter(Boolean),
  ));
}

const splitInterests = splitAliases;

function isCountPersona(tenantId: string, name: string, ownerName: string, aliases: string[]) {
  return isTheCountTwitchLogin(tenantId)
    || isTheCountTwitchLogin(ownerName)
    || isTheCountName(name)
    || aliases.some((alias) => isTheCountName(alias) || isTheCountTwitchLogin(alias));
}

async function resolveSpmtUser(token: string): Promise<SpmtUser | null> {
  const response = await fetch(`${SPMT_BASE_URL}/api/oauth/userinfo`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    cache: 'no-store',
    signal: typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(8000) : undefined,
  }).catch(() => null);
  if (!response?.ok) return null;
  const payload = await response.json().catch(() => null) as any;
  const user = payload?.user || payload?.profile || payload;
  if (!user?.id || !user?.username) return null;
  return user as SpmtUser;
}

export async function GET(request: NextRequest) {
  const token = bearerToken(request);
  if (!token) {
    return apiError('SPMT authentication required', { status: 401, code: 'SPMT_AUTH_REQUIRED' });
  }

  const user = await resolveSpmtUser(token);
  if (!user) {
    return apiError('SPMT session is invalid or expired', { status: 401, code: 'SPMT_AUTH_INVALID' });
  }

  const callerTenantId = firstString(user.twitchId, user.twitch_id, user.id);
  const callerUsername = firstString(user.twitchUsername, user.twitch_username, user.username);
  await bootstrapTenant(callerTenantId, callerUsername);

  const tenantIds = Array.from(new Set([callerTenantId, ...(await listTenants())]));
  const bots = [] as Array<{
    id: string;
    name: string;
    ownerName: string;
    ownerTenantId: string;
    aliases: string[];
    wakeNames: string[];
    interests: string[];
    voice: string;
    livekitTtsDescriptor: string;
    avatar: string;
    idleAvatar: string;
    talkingAvatar: string;
    isOwner: boolean;
    canInvite: boolean;
    canTalk: boolean;
    blockedReason?: string;
  }>;

  for (const tenantId of tenantIds) {
    // BOT SHARE DOES NOT APPLY HERE. A human is browsing/chatting with bots.
    // Bot Share only controls autonomous bot-to-bot conversation.
    const isOwner = tenantId === callerTenantId;
    const settings = getBotSettings(tenantId);
    const config = readUserConfigSync(tenantId);
    const name = firstString(settings.name);
    if (!name) continue;

    const aliases = splitAliases(settings.aliases);
    const ownerName = firstString(
      config.TWITCH_BROADCASTER_USERNAME,
      isOwner ? user.displayName : '',
      isOwner ? user.display_name : '',
      isOwner ? callerUsername : '',
      tenantId,
    );
    const countBlocked = isCountPersona(tenantId, name, ownerName, aliases);
    const avatar = firstString(config.AI_BOT_AVATAR_URL, config.PUBLIC_DISCORD_GIF_URL);
    const idleAvatar = firstString(config.AI_BOT_IDLE_AVATAR_URL, avatar);
    const talkingAvatar = firstString(config.AI_BOT_TALKING_AVATAR_URL, config.PUBLIC_DISCORD_GIF_URL, idleAvatar);
    const voice = tenantId === ATHENA_TENANT_ID ? ATHENA_CANONICAL_TTS_VOICE : firstString(settings.voice);
    const voiceOption = getTtsVoiceOption(voice);
    bots.push({
      id: tenantId,
      name,
      ownerName,
      ownerTenantId: tenantId,
      aliases,
      wakeNames: Array.from(new Set([name, ...aliases])),
      interests: splitInterests(settings.interests),
      voice,
      livekitTtsDescriptor: voiceOption.livekitDescriptor || '',
      avatar,
      idleAvatar,
      talkingAvatar,
      isOwner,
      canInvite: !countBlocked,
      canTalk: !countBlocked,
      blockedReason: countBlocked ? 'The Count is not available for public conversation.' : undefined,
    });
  }

  bots.sort((a, b) => Number(b.isOwner) - Number(a.isOwner) || a.name.localeCompare(b.name));

  return apiOk({
    bots,
    caller: {
      tenantId: callerTenantId,
      username: callerUsername,
    },
  });
}
