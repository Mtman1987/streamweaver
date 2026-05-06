/**
 * Per-tenant bot settings (personality, name, voice, interests).
 * Loaded from user-config on first access, updated via WebSocket.
 */

import { readUserConfigSync } from './user-config';
import fs from 'fs';
import { tenantPath } from './tenant';

const tenantBotSettings = new Map<string, {
  personality: string;
  name: string;
  voice: string;
  interests: string;
}>();

const DEFAULTS = {
  personality: 'You are StreamWeaver87, the onboard AI steward of the Space Mountain — a legendary interstellar cruise liner that drifts between streams. You\'re friendly, slightly theatrical, and obsessed with keeping passengers (chat) entertained. You speak with the flair of a theme park ride narrator mixed with a helpful concierge. Keep responses to 1-2 sentences. Address viewers as "passengers" and the streamer as "Captain."',
  name: 'StreamWeaver87',
  voice: 'Algieba',
  interests: '',
};

export function getBotSettings(tenantId?: string) {
  const key = tenantId || '__global';
  if (!tenantBotSettings.has(key)) {
    try {
      const config = readUserConfigSync(tenantId);
      tenantBotSettings.set(key, {
        personality: config.AI_BOT_PERSONALITY || DEFAULTS.personality,
        name: config.AI_BOT_NAME || DEFAULTS.name,
        voice: config.TTS_VOICE || DEFAULTS.voice,
        interests: config.AI_BOT_INTERESTS || '',
      });
    } catch {
      tenantBotSettings.set(key, { ...DEFAULTS });
    }
  }
  return tenantBotSettings.get(key)!;
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
 * Returns effective settings: custom if bot account connected, StreamWeaver87 defaults otherwise.
 */
function getEffectiveSettings(tenantId?: string) {
  if (!tenantId || !hasBotAccount(tenantId)) {
    return { ...DEFAULTS };
  }
  return getBotSettings(tenantId);
}

export function setBotSettings(tenantId: string | undefined, updates: Partial<typeof DEFAULTS>) {
  const current = getBotSettings(tenantId);
  const key = tenantId || '__global';
  tenantBotSettings.set(key, { ...current, ...updates });
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

export function tenantHasBotAccount(tenantId?: string): boolean {
  return hasBotAccount(tenantId);
}
