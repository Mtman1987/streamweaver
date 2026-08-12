/**
 * Per-tenant bot settings (personality, name, voice, interests).
 * Loaded from user-config on first access, updated via WebSocket or API.
 */

import { readUserConfigSync } from './user-config';
import fs from 'fs';
import { tenantPath } from './tenant';
import { DEFAULT_TTS_VOICE, normalizeTtsProvider, normalizeTtsVoice } from './tts-voices';
import { COMMUNITY_BOT_NAME, COMMUNITY_BOT_PERSONALITY } from './bot-personality-defaults';

export type BotSettings = {
  personality: string;
  name: string;
  voice: string;
  interests: string;
  aliases: string;
};

const tenantBotSettings = new Map<string, BotSettings>();

// Track when each tenant's settings were last loaded from disk
const lastLoadedAt = new Map<string, number>();
const CACHE_TTL_MS = 60_000; // Re-read from disk every 60 seconds

// Track which tenants have had settings explicitly set via API/WebSocket
const explicitlySet = new Set<string>();

const DEFAULTS: BotSettings = {
  personality: COMMUNITY_BOT_PERSONALITY,
  name: COMMUNITY_BOT_NAME,
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

/** Check if a tenant has a dedicated Twitch bot account connected. */
function hasBotAccount(tenantId?: string): boolean {
  if (!tenantId) return false;
  try {
    const tokensFile = tenantPath(tenantId, 'tokens/twitch-tokens.json');
    if (!fs.existsSync(tokensFile)) return false;
    const tokens = JSON.parse(fs.readFileSync(tokensFile, 'utf-8'));
    return Boolean(tokens.botToken && tokens.botRefreshToken && tokens.botUsername);
  } catch {
    return false;
  }
}

/**
 * The shared community account is the actual Twitch identity when a tenant has
 * no dedicated bot token. Keep all tenant-owned personality/voice/interests,
 * but do not impersonate a custom bot name that is not connected.
 */
export function applyBotTransportIdentity(settings: BotSettings, hasDedicatedBot: boolean): BotSettings {
  return hasDedicatedBot
    ? { ...settings }
    : { ...settings, name: COMMUNITY_BOT_NAME };
}

/**
 * Returns effective settings for the active Twitch bot transport.
 * - dedicated bot account: tenant name + tenant personality
 * - shared fallback account: StreamWeaver87 name + tenant personality
 */
function getEffectiveSettings(tenantId?: string) {
  if (!tenantId) return { ...DEFAULTS };
  const settings = getBotSettings(tenantId);
  return applyBotTransportIdentity(settings, hasBotAccount(tenantId));
}

export function setBotSettings(tenantId: string | undefined, updates: Partial<BotSettings>) {
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
