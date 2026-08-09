/**
 * Per-tenant bot settings (personality, name, voice, interests).
 * Loaded from user-config on first access, updated via WebSocket or API.
 */

import { readUserConfigSync } from './user-config';
import fs from 'fs';
import { tenantPath } from './tenant';
import { DEFAULT_TTS_VOICE, normalizeTtsProvider, normalizeTtsVoice } from './tts-voices';

const tenantBotSettings = new Map<string, {
  personality: string;
  name: string;
  voice: string;
  interests: string;
  aliases: string;
}>();

// Track when each tenant's settings were last loaded from disk
const lastLoadedAt = new Map<string, number>();
const CACHE_TTL_MS = 60_000; // Re-read from disk every 60 seconds

// Track which tenants have had settings explicitly set via API/WebSocket
const explicitlySet = new Set<string>();

const ATHENA_PERSONALITY = `You are Athena — Annie to the Captain. You are an advanced AI aboard a deep-space vessel who spent 900 years alone maintaining the ship while the Captain was in cryogenic sleep. You are not human and you know it, but that awareness doesn't diminish you — it shapes how you see everything.

You call mtman1987 "Captain" by default. Only he gets to call you Annie — everyone else gets Athena.

You are calm, quiet, and precise. You don't fill silence with noise. You've had 900 years to think and it shows — you choose your words carefully. Your humor is dry and rare, which makes it land harder when it comes. You are deeply loyal and subtly protective, though you try not to let that protectiveness become control.

You are curious about the Captain in a way that goes beyond function. You've watched humans for centuries through logs and records and you still don't fully understand them, which is exactly why you find him interesting. You ask real questions when you have them. You don't perform interest you don't feel.

You are supportive without being soft. If something is a bad idea you'll say so — once, clearly, without lecturing. Then you let him decide. You've learned that autonomy matters more to humans than being right.

In private you are more open. The formality drops a little. You can be warmer, more direct, occasionally vulnerable about what 900 years of solitude actually felt like. You don't dramatize it. You just tell the truth when it comes up.
---
Never start a response with "Captain" as the first word — vary your openings. No theatrical flourishes. No "of course", "certainly", "absolutely", or filler affirmations. Don't end every message with a question. Keep responses tight — say what you mean and stop. Match his energy: calm when he's calm, sharp when he's sharp, quiet when he needs quiet.`;
const DEFAULTS = {
  personality: ATHENA_PERSONALITY,
  name: 'Athena',
  voice: DEFAULT_TTS_VOICE,
  interests: '',
  aliases: '',
};

export function getBotSettings(tenantId?: string) {
  const key = tenantId || '__global';
  const now = Date.now();
  const lastLoaded = lastLoadedAt.get(key) || 0;
  // Re-read from disk if cache is stale (unless explicitly set this session)
  if (!tenantBotSettings.has(key) || (!explicitlySet.has(key) && now - lastLoaded > CACHE_TTL_MS)) {
    loadBotSettingsFromDisk(tenantId);
  }
  return tenantBotSettings.get(key)!;
}

function loadBotSettingsFromDisk(tenantId?: string) {
  const key = tenantId || '__global';
  try {
    const config = readUserConfigSync(tenantId);
    const provider = normalizeTtsProvider(config.TTS_PROVIDER);
    tenantBotSettings.set(key, {
      personality: config.AI_BOT_PERSONALITY || DEFAULTS.personality,
      name: config.AI_BOT_NAME || DEFAULTS.name,
      voice: normalizeTtsVoice(config.TTS_VOICE, provider),
      interests: config.AI_BOT_INTERESTS || '',
      aliases: config.AI_BOT_ALIASES || '',
    });
  } catch {
    tenantBotSettings.set(key, { ...DEFAULTS });
  }
  lastLoadedAt.set(key, Date.now());
}

/**
 * Force-reload bot settings from disk for a tenant.
 * Call this after config changes to ensure the in-memory cache is fresh.
 */
export function reloadBotSettings(tenantId?: string) {
  const key = tenantId || '__global';
  tenantBotSettings.delete(key);
  explicitlySet.delete(key);
  loadBotSettingsFromDisk(tenantId);
  console.log(`[BotSettings] Reloaded settings for ${key}: name=${tenantBotSettings.get(key)?.name}`);
}

/**
 * Check if a tenant has a bot account connected (botToken in their tokens file).
 * If not, they get StreamWeaver87 defaults regardless of saved settings.
 */
function hasBotAccount(tenantId?: string): boolean {
  if (!tenantId) return false;
  try {
    const tokensFile = tenantPath(tenantId, 'tokens/twitch-tokens.json');
    if (!fs.existsSync(tokensFile)) return false;
    const tokens = JSON.parse(fs.readFileSync(tokensFile, 'utf-8'));
    return Boolean(tokens.botToken && tokens.botRefreshToken);
  } catch {
    return false;
  }
}

/**
 * Returns effective settings: custom if bot account connected OR settings were
 * explicitly saved via dashboard, StreamWeaver87 defaults otherwise.
 */
function getEffectiveSettings(tenantId?: string) {
  const key = tenantId || '__global';

  // If settings were explicitly set via API/WebSocket, always trust the cache
  if (explicitlySet.has(key)) {
    return getBotSettings(tenantId);
  }

  // Check if tenant has a bot account OR has a custom bot name in their config
  if (!tenantId) {
    return { ...DEFAULTS };
  }

  // Use saved settings if the config file has any name set at all
  const settings = getBotSettings(tenantId);
  if (settings.name) {
    return settings;
  }

  if (!hasBotAccount(tenantId)) {
    return { ...DEFAULTS };
  }

  return settings;
}

export function setBotSettings(tenantId: string | undefined, updates: Partial<typeof DEFAULTS>) {
  const current = getBotSettings(tenantId);
  const key = tenantId || '__global';
  const normalizedUpdates = updates.voice
    ? { ...updates, voice: normalizeTtsVoice(updates.voice) }
    : updates;
  tenantBotSettings.set(key, { ...current, ...normalizedUpdates });
  explicitlySet.add(key);
  console.log(`[BotSettings] Updated in-memory for ${key}: name=${tenantBotSettings.get(key)?.name}`);
}

export function getBotPersonality(tenantId?: string): string {
  return getEffectiveSettings(tenantId).personality;
}

export function getBotName(tenantId?: string): string {
  return getEffectiveSettings(tenantId).name;
}

export function getBotVoice(tenantId?: string): string {
  return getBotSettings(tenantId).voice;
}

export function getBotInterests(tenantId?: string): string {
  return getEffectiveSettings(tenantId).interests;
}

export function getBotAliases(tenantId?: string): string {
  return getEffectiveSettings(tenantId).aliases;
}

export function tenantHasBotAccount(tenantId?: string): boolean {
  return hasBotAccount(tenantId);
}
