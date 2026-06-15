export type DiscordProcessingArea =
  | 'public-command'
  | 'public-ai'
  | 'public-bridge'
  | 'public-history'
  | 'botshare'
  | 'ignore'
  | 'crossbot'
  | 'cleanup'
  | 'dm-image'
  | 'dm-genmode'
  | 'dm-private-ai';

export type DiscordProcessingOwner = 'route' | 'poll' | 'both' | 'off';

const DEFAULT_OWNERS: Record<DiscordProcessingArea, DiscordProcessingOwner> = {
  'public-command': 'poll',
  'public-ai': 'route',
  'public-bridge': 'poll',
  'public-history': 'route',
  botshare: 'route',
  ignore: 'route',
  crossbot: 'route',
  cleanup: 'route',
  'dm-image': 'route',
  'dm-genmode': 'route',
  'dm-private-ai': 'route',
};

const ENV_NAMES: Record<DiscordProcessingArea, string> = {
  'public-command': 'DISCORD_PUBLIC_COMMAND_OWNER',
  'public-ai': 'DISCORD_PUBLIC_AI_OWNER',
  'public-bridge': 'DISCORD_PUBLIC_BRIDGE_OWNER',
  'public-history': 'DISCORD_PUBLIC_HISTORY_OWNER',
  botshare: 'DISCORD_BOTSHARE_OWNER',
  ignore: 'DISCORD_IGNORE_OWNER',
  crossbot: 'DISCORD_CROSSBOT_OWNER',
  cleanup: 'DISCORD_CLEANUP_OWNER',
  'dm-image': 'DISCORD_DM_IMAGE_OWNER',
  'dm-genmode': 'DISCORD_DM_GENMODE_OWNER',
  'dm-private-ai': 'DISCORD_DM_PRIVATE_AI_OWNER',
};

function normalizeOwner(value: string | undefined, fallback: DiscordProcessingOwner): DiscordProcessingOwner {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'route' || normalized === 'poll' || normalized === 'both' || normalized === 'off') {
    return normalized;
  }
  return fallback;
}

export function getDiscordProcessingOwner(area: DiscordProcessingArea): DiscordProcessingOwner {
  return normalizeOwner(process.env[ENV_NAMES[area]], DEFAULT_OWNERS[area]);
}

export function discordRouteOwns(area: DiscordProcessingArea): boolean {
  const owner = getDiscordProcessingOwner(area);
  return owner === 'route' || owner === 'both';
}

export function discordPollOwns(area: DiscordProcessingArea): boolean {
  const owner = getDiscordProcessingOwner(area);
  return owner === 'poll' || owner === 'both';
}
