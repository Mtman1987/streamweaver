export type ProcessingArea =
  | 'public-command'
  | 'public-ai'
  | 'public-bridge'
  | 'public-history'
  | 'state-command'
  | 'ignore-command'
  | 'crossbot'
  | 'cleanup'
  | 'dm-image'
  | 'dm-genmode'
  | 'dm-private-ai';

export type ProcessingOwner = 'route' | 'poll' | 'both' | 'off';

const DEFAULT_OWNERS: Record<ProcessingArea, ProcessingOwner> = {
  // Default public Discord side effects to the route because /api/discord/chat is
  // the first intake point and currently has the newer Discord-specific command,
  // AI, cross-bot, cleanup, and webhook identity behavior. Polling can be made
  // the owner later by setting the matching DUPLICATE_PRONE_* env var.
  'public-command': 'route',
  'public-ai': 'route',
  'public-bridge': 'route',
  'public-history': 'route',
  'state-command': 'route',
  'ignore-command': 'route',
  crossbot: 'route',
  cleanup: 'route',
  'dm-image': 'route',
  'dm-genmode': 'route',
  'dm-private-ai': 'route',
};

const ENV_NAMES: Record<ProcessingArea, string> = {
  'public-command': 'DUPLICATE_PRONE_PUBLIC_COMMAND_OWNER',
  'public-ai': 'DUPLICATE_PRONE_PUBLIC_AI_OWNER',
  'public-bridge': 'DUPLICATE_PRONE_PUBLIC_BRIDGE_OWNER',
  'public-history': 'DUPLICATE_PRONE_PUBLIC_HISTORY_OWNER',
  'state-command': 'DUPLICATE_PRONE_STATE_COMMAND_OWNER',
  'ignore-command': 'DUPLICATE_PRONE_IGNORE_COMMAND_OWNER',
  crossbot: 'DUPLICATE_PRONE_CROSSBOT_OWNER',
  cleanup: 'DUPLICATE_PRONE_CLEANUP_OWNER',
  'dm-image': 'DUPLICATE_PRONE_DM_IMAGE_OWNER',
  'dm-genmode': 'DUPLICATE_PRONE_DM_GENMODE_OWNER',
  'dm-private-ai': 'DUPLICATE_PRONE_DM_PRIVATE_AI_OWNER',
};

function normalizeOwner(value: string | undefined, fallback: ProcessingOwner): ProcessingOwner {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'route' || normalized === 'poll' || normalized === 'both' || normalized === 'off') {
    return normalized;
  }
  return fallback;
}

export function getProcessingOwner(area: ProcessingArea): ProcessingOwner {
  return normalizeOwner(process.env[ENV_NAMES[area]], DEFAULT_OWNERS[area]);
}

export function routeOwns(area: ProcessingArea): boolean {
  const owner = getProcessingOwner(area);
  return owner === 'route' || owner === 'both';
}

export function pollOwns(area: ProcessingArea): boolean {
  const owner = getProcessingOwner(area);
  return owner === 'poll' || owner === 'both';
}

// Backwards-compatible names for the first Discord-specific draft of this helper.
export type DiscordProcessingArea = ProcessingArea;
export type DiscordProcessingOwner = ProcessingOwner;
export const getDiscordProcessingOwner = getProcessingOwner;
export const discordRouteOwns = routeOwns;
export const discordPollOwns = pollOwns;
