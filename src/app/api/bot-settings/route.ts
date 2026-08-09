import { NextRequest } from 'next/server';
import { writeUserConfig } from '@/lib/user-config';
import { setBotSettings, reloadBotSettings } from '@/lib/bot-settings-store';
import { apiError, apiOk } from '@/lib/api-response';
import { getTenantFromRequest } from '@/lib/tenant-context';
import { z } from 'zod';
import { normalizeTtsVoice } from '@/lib/tts-voices';
import { getMode, setMode } from '@/services/modes-manager';

const MAX_PERSONALITY_CHARACTERS = 20_000;

const botSettingsSchema = z.object({
  personality: z.string().trim().min(1).max(MAX_PERSONALITY_CHARACTERS).optional(),
  voice: z.string().trim().min(1).max(128).optional(),
  name: z.string().trim().min(1).max(128).optional(),
  interests: z.string().trim().max(500).optional(),
  aliases: z.string().trim().max(500).optional(),
  skipShoutoutOverlay: z.boolean().optional(),
});

export async function GET(request: NextRequest) {
  const session = getTenantFromRequest(request);
  if (!session?.tenantId) {
    return apiError('Unauthorized', { status: 401, code: 'UNAUTHORIZED' });
  }

  const greetingMode = await getMode('greetingmode', session.tenantId);
  return apiOk({
    greetingMode,
    skipShoutoutOverlay: greetingMode === 'chat',
  });
}

/**
 * Auto-optimize personality if it's missing the --- delimiter.
 * Calls the optimize-personality endpoint internally.
 */
async function autoOptimize(personality: string, botName: string): Promise<string> {
  // Already structured — has our delimiter
  if (personality.includes('\n---\n') || personality.includes('\n---')) {
    return personality;
  }

  const edenaiKey = process.env.EDENAI_API_KEY;
  if (!edenaiKey) return personality; // Can't optimize without key, save as-is

  try {
    console.log('[Bot Settings] Personality missing --- delimiter, auto-optimizing...');
    const port = process.env.PORT || 3100;
    const res = await fetch(`http://127.0.0.1:${port}/api/ai/optimize-personality`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ personality, botName }),
    });

    if (res.ok) {
      const data = await res.json();
      const optimized = data.optimized || data.data?.optimized;
      if (optimized && optimized.includes('---')) {
        console.log('[Bot Settings] Auto-optimization successful');
        return optimized;
      }
    }
    console.warn('[Bot Settings] Auto-optimization failed, saving raw');
    return personality;
  } catch (e) {
    console.warn('[Bot Settings] Auto-optimization error:', e);
    return personality;
  }
}

export async function POST(request: NextRequest) {
  try {
    const parsed = botSettingsSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      const personalityTooLong = parsed.error.issues.some(
        (issue) => issue.path[0] === 'personality' && issue.code === 'too_big',
      );
      return apiError(
        personalityTooLong
          ? `Personality is too large. Maximum length is ${MAX_PERSONALITY_CHARACTERS.toLocaleString()} characters.`
          : 'Invalid request body',
        { status: 400, code: 'INVALID_BODY' },
      );
    }

    const { personality: rawPersonality, voice, name, interests, aliases, skipShoutoutOverlay } = parsed.data;
    const session = getTenantFromRequest(request);
    const tid = session?.tenantId;

    if (!rawPersonality && !voice && !name && !interests && aliases == null && skipShoutoutOverlay == null) {
      return apiError('At least one setting is required', { status: 400, code: 'INVALID_BODY' });
    }

    // Auto-optimize personality into structured format if missing delimiter
    const personality = rawPersonality
      ? await autoOptimize(rawPersonality, name || 'AI Bot')
      : undefined;

    // Update in-memory per-tenant store
    const botUpdates: Record<string, string> = {};
    if (personality) botUpdates.personality = personality;
    const normalizedVoice = voice ? normalizeTtsVoice(voice) : undefined;
    if (normalizedVoice) botUpdates.voice = normalizedVoice;
    if (name) botUpdates.name = name;
    if (interests) botUpdates.interests = interests;
    if (aliases != null) botUpdates.aliases = aliases;
    setBotSettings(tid, botUpdates);

    // Persist to user-config.json
    const configUpdates: Record<string, string> = {};
    if (name) { configUpdates.AI_BOT_NAME = name; console.log(`[API] Updated bot name to: ${name}`); }
    if (normalizedVoice) { configUpdates.TTS_VOICE = normalizedVoice; console.log(`[API] Updated bot voice to: ${normalizedVoice}`); }
    if (personality) { configUpdates.AI_BOT_PERSONALITY = personality; console.log('[API] Updated bot personality'); }
    if (interests) { configUpdates.AI_BOT_INTERESTS = interests; console.log('[API] Updated bot interests'); }
    if (aliases != null) { configUpdates.AI_BOT_ALIASES = aliases; console.log(`[API] Updated bot aliases to: ${aliases}`); }
    if (skipShoutoutOverlay != null) {
      await setMode('greetingmode', skipShoutoutOverlay ? 'chat' : 'full', tid);
      console.log(`[API] Updated skip shoutout overlay to: ${skipShoutoutOverlay}`);
    }

    if (Object.keys(configUpdates).length > 0) {
      await writeUserConfig(configUpdates, tid);
      console.log('[API] Saved to user-config.json:', configUpdates);
      // Force reload from disk to ensure cache is consistent
      reloadBotSettings(tid);
    }

    return apiOk({ success: true });
  } catch (error) {
    console.error('[API] Error updating bot settings:', error);
    return apiError('Failed to update settings', { status: 500, code: 'INTERNAL_ERROR' });
  }
}
