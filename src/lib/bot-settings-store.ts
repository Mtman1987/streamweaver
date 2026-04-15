/**
 * Per-tenant bot settings (personality, name, voice, interests).
 * Loaded from user-config on first access, updated via WebSocket.
 */

import { readUserConfigSync } from './user-config';

const tenantBotSettings = new Map<string, {
  personality: string;
  name: string;
  voice: string;
  interests: string;
}>();

const DEFAULTS = {
  personality: 'You are a helpful AI assistant.',
  name: 'AI Bot',
  voice: 'Algieba',
  interests: '',
};

export function getBotSettings(tenantId?: string) {
  const key = tenantId || '__global';
  if (!tenantBotSettings.has(key)) {
    // Load from user-config on first access
    try {
      const config = readUserConfigSync(tenantId);
      tenantBotSettings.set(key, {
        personality: DEFAULTS.personality,
        name: config.AI_BOT_NAME || DEFAULTS.name,
        voice: config.TTS_VOICE || DEFAULTS.voice,
        interests: '',
      });
    } catch {
      tenantBotSettings.set(key, { ...DEFAULTS });
    }
  }
  return tenantBotSettings.get(key)!;
}

export function setBotSettings(tenantId: string | undefined, updates: Partial<typeof DEFAULTS>) {
  const current = getBotSettings(tenantId);
  const key = tenantId || '__global';
  tenantBotSettings.set(key, { ...current, ...updates });
}

export function getBotPersonality(tenantId?: string): string {
  return getBotSettings(tenantId).personality;
}

export function getBotName(tenantId?: string): string {
  return getBotSettings(tenantId).name;
}

export function getBotVoice(tenantId?: string): string {
  return getBotSettings(tenantId).voice;
}

export function getBotInterests(tenantId?: string): string {
  return getBotSettings(tenantId).interests;
}
