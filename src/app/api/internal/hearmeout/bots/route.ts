import { NextRequest } from 'next/server';
import { apiError, apiOk } from '@/lib/api-response';
import { listTenants } from '@/lib/tenant';
import { getBotSettings } from '@/lib/bot-settings-store';
import { readUserConfigSync } from '@/lib/user-config';
import { hasInternalServiceAccess } from '@/lib/internal-service-auth';
import { ATHENA_CANONICAL_TTS_VOICE, ATHENA_TENANT_ID, getTtsVoiceOption } from '@/lib/tts-voices';
import {
  THE_COUNT_NAME,
  THE_COUNT_TWITCH_LOGIN,
  isTheCountName,
  isTheCountTwitchLogin,
} from '@/lib/the-count';

function text(value: unknown) {
  return String(value || '').trim();
}

function entries(value: unknown) {
  return Array.from(new Set(
    text(value)
      .split(/[\n,;|]+/)
      .map((entry) => entry.trim())
      .filter(Boolean),
  ));
}

function isCountPersona(input: {
  tenantId: string;
  name: string;
  ownerName: string;
  aliases: string[];
}) {
  return isTheCountTwitchLogin(input.tenantId)
    || isTheCountTwitchLogin(input.ownerName)
    || isTheCountName(input.name)
    || input.aliases.some((alias) => isTheCountName(alias) || isTheCountTwitchLogin(alias));
}

type PublicHearMeOutBot = {
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
  canInvite: boolean;
  canTalk: boolean;
  blockedReason?: string;
};

export async function GET(request: NextRequest) {
  if (!hasInternalServiceAccess(request)) {
    return apiError('Unauthorized', { status: 401, code: 'UNAUTHORIZED' });
  }

  const tenantIds = Array.from(new Set(await listTenants()));
  const bots: PublicHearMeOutBot[] = [];

  for (const tenantId of tenantIds) {
    const settings = getBotSettings(tenantId);
    const name = text(settings.name);
    if (!name) continue;

    const config = readUserConfigSync(tenantId);
    const ownerName = text(config.TWITCH_BROADCASTER_USERNAME || tenantId);
    const aliases = entries(settings.aliases);
    const interests = entries(settings.interests);
    const avatar = text(config.AI_BOT_AVATAR_URL || config.PUBLIC_DISCORD_GIF_URL);
    const idleAvatar = text(config.AI_BOT_IDLE_AVATAR_URL || avatar);
    const talkingAvatar = text(config.AI_BOT_TALKING_AVATAR_URL || config.PUBLIC_DISCORD_GIF_URL || idleAvatar);
    const voice = tenantId === ATHENA_TENANT_ID ? ATHENA_CANONICAL_TTS_VOICE : text(settings.voice);
    const voiceOption = getTtsVoiceOption(voice);
    const countBlocked = isCountPersona({ tenantId, name, ownerName, aliases });

    bots.push({
      id: tenantId,
      name,
      ownerName,
      ownerTenantId: tenantId,
      aliases,
      wakeNames: Array.from(new Set([name, ...aliases])),
      interests,
      voice,
      livekitTtsDescriptor: voiceOption.livekitDescriptor || '',
      avatar,
      idleAvatar,
      talkingAvatar,
      canInvite: !countBlocked,
      canTalk: !countBlocked,
      blockedReason: countBlocked ? 'The Count is not available for public conversation.' : undefined,
    });
  }

  // The Count is a system persona, not necessarily a normal tenant. The public
  // gallery promises every SPMT bot plus this one explicit non-conversational
  // exception, so keep it visible even when no tenant record exists for it.
  if (!bots.some((bot) => isCountPersona({
    tenantId: bot.ownerTenantId,
    name: bot.name,
    ownerName: bot.ownerName,
    aliases: bot.aliases,
  }))) {
    bots.push({
      id: THE_COUNT_TWITCH_LOGIN,
      name: THE_COUNT_NAME,
      ownerName: THE_COUNT_TWITCH_LOGIN,
      ownerTenantId: THE_COUNT_TWITCH_LOGIN,
      aliases: ['Count', 'TheCountSPMT'],
      wakeNames: [THE_COUNT_NAME, 'Count', 'TheCountSPMT'],
      interests: [],
      voice: '',
      livekitTtsDescriptor: '',
      avatar: '',
      idleAvatar: '',
      talkingAvatar: '',
      canInvite: false,
      canTalk: false,
      blockedReason: 'The Count is not available for public conversation.',
    });
  }

  bots.sort((a, b) => a.name.localeCompare(b.name));
  return apiOk({ bots });
}
