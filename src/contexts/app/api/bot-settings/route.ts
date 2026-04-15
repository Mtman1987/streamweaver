import { NextRequest } from 'next/server';
import { writeUserConfig } from '@/lib/user-config';
import { setBotSettings } from '@/lib/bot-settings-store';
import { apiError, apiOk } from '@/lib/api-response';
import { getTenantFromRequest } from '@/lib/tenant-context';
import { z } from 'zod';

const botSettingsSchema = z.object({
  personality: z.string().trim().min(1).max(5000).optional(),
  voice: z.string().trim().min(1).max(128).optional(),
  name: z.string().trim().min(1).max(128).optional(),
  interests: z.string().trim().max(500).optional(),
});

export async function POST(request: NextRequest) {
  try {
    const parsed = botSettingsSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return apiError('Invalid request body', { status: 400, code: 'INVALID_BODY' });
    }

    const { personality, voice, name, interests } = parsed.data;
    const session = getTenantFromRequest(request);
    const tid = session?.tenantId;

    if (!personality && !voice && !name && !interests) {
      return apiError('At least one setting is required', { status: 400, code: 'INVALID_BODY' });
    }

    // Update in-memory per-tenant store
    const botUpdates: Record<string, string> = {};
    if (personality) botUpdates.personality = personality;
    if (voice) botUpdates.voice = voice;
    if (name) botUpdates.name = name;
    if (interests) botUpdates.interests = interests;
    setBotSettings(tid, botUpdates);

    // Persist to user-config.json
    const configUpdates: Record<string, string> = {};
    if (name) { configUpdates.AI_BOT_NAME = name; console.log(`[API] Updated bot name to: ${name}`); }
    if (voice) { configUpdates.TTS_VOICE = voice; console.log(`[API] Updated bot voice to: ${voice}`); }
    if (personality) console.log('[API] Updated bot personality');
    if (interests) console.log('[API] Updated bot interests');

    if (Object.keys(configUpdates).length > 0) {
      await writeUserConfig(configUpdates, tid);
      console.log('[API] Saved to user-config.json:', configUpdates);
    }

    return apiOk({ success: true });
  } catch (error) {
    console.error('[API] Error updating bot settings:', error);
    return apiError('Failed to update settings', { status: 500, code: 'INTERNAL_ERROR' });
  }
}
