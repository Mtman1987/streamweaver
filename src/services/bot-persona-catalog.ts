import { listTenants } from '@/lib/tenant';
import { getBotSettings } from '@/lib/bot-settings-store';
import { readUserConfigSync } from '@/lib/user-config';
import { ATHENA_CANONICAL_TTS_VOICE, ATHENA_TENANT_ID, getTtsVoiceOption } from '@/lib/tts-voices';
import { isTheCountName, isTheCountTwitchLogin } from '@/lib/the-count';

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

function isCountPersona(tenantId: string, name: string, ownerName: string, aliases: string[]) {
  return isTheCountTwitchLogin(tenantId)
    || isTheCountTwitchLogin(ownerName)
    || isTheCountName(name)
    || aliases.some((alias) => isTheCountName(alias) || isTheCountTwitchLogin(alias));
}

export async function resolveBotPersonaForAction(selector: string, callerTenantId: string): Promise<ActionBotPersona> {
  const needle = normalized(selector);
  if (!needle) throw new Error('Name the bot that should join or leave HearMeOut.');
  const matches: ActionBotPersona[] = [];
  const tenantIds = Array.from(new Set([callerTenantId, ...(await listTenants())]));
  for (const tenantId of tenantIds) {
    // BOT SHARE DOES NOT APPLY HERE. This selector is reached because a human
    // explicitly asked for a persona. Bot Share only controls autonomous
    // bot-to-bot conversation.
    const settings = getBotSettings(tenantId);
    const name = text(settings.name);
    if (!name) continue;
    const aliases = entries(settings.aliases);
    const names = [tenantId, name, ...aliases].map(normalized);
    if (!names.includes(needle)) continue;
    const config = readUserConfigSync(tenantId);
    const ownerName = text(config.TWITCH_BROADCASTER_USERNAME || tenantId);
    const avatar = text(config.AI_BOT_AVATAR_URL || config.PUBLIC_DISCORD_GIF_URL);
    const idleAvatar = text(config.AI_BOT_IDLE_AVATAR_URL || avatar);
    const talkingAvatar = text(config.AI_BOT_TALKING_AVATAR_URL || config.PUBLIC_DISCORD_GIF_URL || idleAvatar);
    const voice = tenantId === ATHENA_TENANT_ID ? ATHENA_CANONICAL_TTS_VOICE : text(settings.voice);
    matches.push({
      id: tenantId,
      name,
      ownerName,
      ownerTenantId: tenantId,
      aliases,
      wakeNames: Array.from(new Set([name, ...aliases])),
      interests: entries(settings.interests),
      voice,
      livekitTtsDescriptor: getTtsVoiceOption(voice).livekitDescriptor || '',
      avatar,
      idleAvatar,
      talkingAvatar,
      canInvite: !isCountPersona(tenantId, name, ownerName, aliases),
    });
  }
  if (!matches.length) throw new Error(`No available tenant bot matches ${selector}.`);
  if (matches.length > 1) throw new Error(`More than one tenant bot matches ${selector}. Use its tenant name.`);
  return matches[0];
}
