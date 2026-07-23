import { getConfigSection, updateConfigSection } from './local-config/service';
import type { LocalConfigMap } from './local-config/schemas';

export type DiscordRuntimeConfig = LocalConfigMap['discord'];

export async function readDiscordConfig(tenantId?: string): Promise<DiscordRuntimeConfig> {
  return getConfigSection('discord', tenantId);
}

export async function updateDiscordConfig(
  updates: Partial<DiscordRuntimeConfig>,
  tenantId?: string,
): Promise<DiscordRuntimeConfig> {
  return updateConfigSection('discord', updates, tenantId);
}

export function publicDiscordConfig(config: Partial<DiscordRuntimeConfig> | null | undefined) {
  return {
    guildId: config?.guildId || '',
    logChannelId: config?.logChannelId || '',
    aiChatChannelId: config?.aiChatChannelId || '',
    shoutoutChannelId: config?.shoutoutChannelId || '',
    dmChannelId: config?.dmChannelId || '',
    discordUserId: config?.discordUserId || '',
    discordUsername: config?.discordUsername || '',
    dmEnabled: config?.dmEnabled === true,
    discordBridgeEnabled: config?.discordBridgeEnabled !== false,
  };
}
