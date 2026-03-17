import { NextRequest, NextResponse } from 'next/server';
import { writeUserConfig } from '@/lib/user-config';
import { apiError, apiOk } from '@/lib/api-response';
import { z } from 'zod';

const botSettingsSchema = z
  .object({
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

    const { personality, voice, name } = parsed.data;
    const updates: Record<string, string> = {};

    if (!personality && !voice && !name) {
      return apiError('At least one setting is required', { status: 400, code: 'INVALID_BODY' });
    }
    
    if (personality) {
      (global as any).botPersonality = personality;
      console.log('[API] Updated bot personality');
    }
    
    if (voice) {
      (global as any).botVoice = voice;
      updates.TTS_VOICE = voice;
      console.log(`[API] Updated bot voice to: ${voice}`);
    }
    
    if (name) {
      (global as any).botName = name;
      updates.AI_BOT_NAME = name;
      console.log(`[API] Updated bot name to: ${name}`);
    }
    
    // Save to user-config.json
    if (Object.keys(updates).length > 0) {
      await writeUserConfig(updates);
      console.log('[API] Saved to user-config.json:', updates);
    }
    
    return apiOk({ success: true });
  } catch (error) {
    console.error('[API] Error updating bot settings:', error);
    return apiError('Failed to update settings', { status: 500, code: 'INTERNAL_ERROR' });
  }
}