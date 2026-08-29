import { listTenants } from '@/lib/tenant';
import { getBotSettings } from '@/lib/bot-settings-store';
import { getBotShareMode } from '@/lib/bot-interactions-store';
import { readUserConfigSync } from '@/lib/user-config';
import { ATHENA_CANONICAL_TTS_VOICE, ATHENA_TENANT_ID, getTtsVoiceOption } from '@/lib/tts-voices';

export type ActionBotPersona = {
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
};

function text(value: unknown) {
  return String(value || '').trim();
}

function entries(value: unknown) {
  return Array.from(new Set(text(value).split(/[\n,;|]+/).map((entry) => entry.trim()).filter(Boolean)));
}

function normalized(value: unknown) {
  return text(value).replace(/^@/, '').toLowerCase();
}

export async function resolveBotPersonaForAction(selector: string, callerTenantId: string): Promise<ActionBotPersona> {
  const needle = normalized(selector);
  if (!needle) throw new Error('Name the bot that should join or leave HearMeOut.');
  const matches: ActionBotPersona[] = [];
  const tenantIds = Array.from(new Set([callerTenantId, ...(await listTenants())]));
  for (const tenantId of tenantIds) {
    const owned = tenantId === callerTenantId;
    const shareMode = await getBotShareMode(tenantId);
    if (!owned && shareMode !== 'on') continue;
    const settings = getBotSettings(tenantId);
    const name = text(settings.name);
    if (!name) continue;
    const aliases = entries(settings.aliases);
    const names = [tenantId, name, ...aliases].map(normalized);
    if (!names.includes(needle)) continue;
    const config = readUserConfigSync(tenantId);
    const avatar = text(config.AI_BOT_AVATAR_URL || config.PUBLIC_DISCORD_GIF_URL);
    const idleAvatar = text(config.AI_BOT_IDLE_AVATAR_URL || avatar);
    const talkingAvatar = text(config.AI_BOT_TALKING_AVATAR_URL || config.PUBLIC_DISCORD_GIF_URL || idleAvatar);
    const voice = tenantId === ATHENA_TENANT_ID ? ATHENA_CANONICAL_TTS_VOICE : text(settings.voice);
    matches.push({
      id: tenantId,
      name,
      ownerName: text(config.TWITCH_BROADCASTER_USERNAME || tenantId),
      ownerTenantId: tenantId,
      aliases,
      wakeNames: Array.from(new Set([name, ...aliases])),
      interests: entries(settings.interests),
      voice,
      livekitTtsDescriptor: getTtsVoiceOption(voice).livekitDescriptor || '',
      avatar,
      idleAvatar,
      talkingAvatar,
      canInvite: owned || shareMode === 'on',
    });
  }
  if (!matches.length) throw new Error(`No available tenant bot matches ${selector}.`);
  if (matches.length > 1) throw new Error(`More than one tenant bot matches ${selector}. Use its tenant name.`);
  return matches[0];
}
