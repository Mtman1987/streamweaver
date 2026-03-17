import { NextRequest } from 'next/server';
import { handleVoiceShoutout } from '@/services/voice-shoutout';
import { apiError, apiOk } from '@/lib/api-response';
import { z } from 'zod';

const schema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(128),
});

export async function POST(request: NextRequest) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return apiError('Name is required', { status: 400, code: 'INVALID_BODY' });
  }

  try {
    console.log('[Voice Shoutout API] Triggering shoutout for:', parsed.data.name);
    await handleVoiceShoutout(parsed.data.name);
    return apiOk({ success: true });
  } catch (error: any) {
    console.error('[Voice Shoutout API] Error:', error.message);
    return apiError(error.message || 'Shoutout failed', { status: 500, code: 'SHOUTOUT_FAILED' });
  }
}
