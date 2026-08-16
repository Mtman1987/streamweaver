/**
 * Known Bots Service
 * Maintains a default list of known Twitch bots + per-tenant custom additions.
 * Used to skip welcome wagon, shoutouts, AI mentions, etc.
 */

import { readJsonFile, writeJsonFile, StorageContext } from './storage';

const CUSTOM_BOTS_FILE = 'known-bots-custom.json';

// Comprehensive default list of known Twitch bots
// Sources: community lists, common bot accounts seen across streams
const DEFAULT_KNOWN_BOTS: string[] = [
  // Major bot platforms
  'streamelements', 'streamlabs', 'nightbot', 'moobot', 'fossabot',
  'wizebot', 'deepbot', 'phantombot', 'coebot', 'ankhbot',
  'botisimo', 'streamlabsbot', 'streamjar',

  // Twitch official / system
  'twitchnotify', 'jtv',

  // Analytics & tracking bots
  'sery_bot', 'commanderroot', 'lurxx', 'virgoproz', 'drapsnatt',
  'logviewer', 'streamholics', 'anotherttvviewer', 'electricallongboard',
  'electricalskateboard', 'teyyd', 'v_and_k', 'feuerwehr',
  'communityshowcase', 'skinnyseahorse', 'social_rise_bot',

  // Data collection / viewbots
  'bspot', 'hostmodeon', 'p0lizei_', 'zanekyber', 'n3td3v',
  'communityshowcase', 'own3d', 'moocat', 'twitchprimereminder',
  'lolrankbot', 'facts_bot', 'knowsenpai', 'lattemotte',

  // Music / song request bots
  'songlistbot', 'pretzelrocks', 'soundalerts',

  // Moderation bots
  'automodbot', 'supibot', 'okayeg', 'pajbot', 'snusbot',

  // Charity / event bots
  'tabortime', 'tiltify', 'streamloots',

  // Clip / highlight bots
  'clipr', 'medal_tv', 'owncast',

  // Misc well-known bots
  'pokemoncommunitygame', 'streamavatars', 'laia_bot', 'creatisbot',
  'buttsbot', 'kofistreambot', 'streamboosters', 'rainmaker',
  'restreambot', 'warpworldbot', 'streamerbot', 'dixperbro',
  'streamcaptainbot', 'tangiabot', 'tangibot', 'soundboardbot',

  // StreamWeaver's own bots
  'streamweaverbot', 'streamweaver87',
];

// In-memory cache per tenant
const tenantCustomBots = new Map<string, Set<string>>();

function toCtx(tenantId?: string): StorageContext | undefined {
  if (!tenantId) return undefined;
  return { tenantId, username: '' };
}

async function loadCustomBots(tenantId?: string): Promise<Set<string>> {
  const key = tenantId || '__global';
  if (tenantCustomBots.has(key)) return tenantCustomBots.get(key)!;

  const data = await readJsonFile<{ bots: string[] }>(CUSTOM_BOTS_FILE, { bots: [] }, toCtx(tenantId));
  const set = new Set(data.bots.map(b => b.toLowerCase()));
  if (tenantId) {
    const globalData = await readJsonFile<{ bots: string[] }>(CUSTOM_BOTS_FILE, { bots: [] });
    for (const bot of globalData.bots) {
      if (typeof bot === 'string') set.add(bot.toLowerCase());
    }
  }
  tenantCustomBots.set(key, set);
  return set;
}

async function saveCustomBots(bots: Set<string>, tenantId?: string): Promise<void> {
  await writeJsonFile(CUSTOM_BOTS_FILE, { bots: Array.from(bots).sort() }, toCtx(tenantId));
}

/**
 * Check if a username is a known bot.
 */
export async function isKnownBot(username: string, tenantId?: string): Promise<boolean> {
  const lower = username.toLowerCase();
  if (DEFAULT_KNOWN_BOTS.includes(lower)) return true;
  const custom = await loadCustomBots(tenantId);
  return custom.has(lower);
}

/**
 * Synchronous check against default list only (for hot paths).
 */
export function isKnownBotSync(username: string): boolean {
  return DEFAULT_KNOWN_BOTS.includes(username.toLowerCase());
}

/**
 * Add a bot to the tenant's custom list.
 */
export async function addCustomBot(username: string, tenantId?: string): Promise<boolean> {
  const custom = await loadCustomBots(tenantId);
  const lower = username.toLowerCase();
  if (custom.has(lower)) return false;
  custom.add(lower);
  await saveCustomBots(custom, tenantId);
  return true;
}

/**
 * Remove a bot from the tenant's custom list.
 */
export async function removeCustomBot(username: string, tenantId?: string): Promise<void> {
  const lower = username.toLowerCase();
  const custom = await loadCustomBots(tenantId);
  custom.delete(lower);
  await saveCustomBots(custom, tenantId);

  if (tenantId) {
    const globalCustom = await loadCustomBots();
    if (globalCustom.delete(lower)) {
      await saveCustomBots(globalCustom);
      tenantCustomBots.delete('__global');
    }
  }
}

/**
 * Get the full list (defaults + custom) for a tenant.
 */
export async function getAllKnownBots(tenantId?: string): Promise<string[]> {
  const custom = await loadCustomBots(tenantId);
  return [...new Set([...DEFAULT_KNOWN_BOTS, ...Array.from(custom)])].sort();
}

/**
 * Get just the custom bots for a tenant.
 */
export async function getCustomBots(tenantId?: string): Promise<string[]> {
  const custom = await loadCustomBots(tenantId);
  return Array.from(custom).sort();
}

/**
 * Get the default bot list.
 */
export function getDefaultBots(): string[] {
  return [...DEFAULT_KNOWN_BOTS].sort();
}

/**
 * Clear the in-memory cache (e.g. after config changes).
 */
export function clearBotCache(tenantId?: string): void {
  const key = tenantId || '__global';
  tenantCustomBots.delete(key);
}
