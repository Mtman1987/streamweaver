import { NextRequest, NextResponse } from 'next/server';
import { generateTTS } from '@/services/tts-provider';
import { apiError, apiOk } from '@/lib/api-response';
import { z } from 'zod';
import { getTenantFromRequest } from '@/lib/tenant-context';
import { hasInternalServiceAccess, hasMountainViewBridgeAccess } from '@/lib/internal-service-auth';

const ttsSchema = z.object({
  text: z.string().trim().min(1, 'Text is required').max(2000, 'Text too long'),
  voice: z.string().trim().min(1).max(128).optional(),
  tenantId: z.string().trim().max(128).optional(),
});

export async function POST(request: NextRequest) {
  try {
    const session = getTenantFromRequest(request);
    const isMountainViewBridge = hasMountainViewBridgeAccess(request);
    const isInternalService = hasInternalServiceAccess(request);
    if (!session && !isMountainViewBridge && !isInternalService) {
      return apiError('Unauthorized', { status: 401, code: 'UNAUTHORIZED' });
    }

    const parsed = ttsSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      console.error('[TTS API] Invalid request body:', parsed.error.flatten());
      return apiError('Invalid request body', { status: 400, code: 'INVALID_BODY' });
    }

    const { text, voice } = parsed.data;
    const tenantId = session?.tenantId || (isMountainViewBridge || isInternalService ? parsed.data.tenantId : undefined);
    if (!tenantId) {
      return apiError('Tenant context required', { status: 400, code: 'TENANT_REQUIRED' });
    }
    console.log('[TTS API] Request:', { textLength: text.length, textPreview: text.slice(0, 80), voice: voice ?? '(default)', tenantId: tenantId ?? 'global' });

    const audioDataUri = await generateTTS(text, voice, tenantId);
    console.log('[TTS API] Success, audioDataUri length:', audioDataUri.length);
    return apiOk({ audioDataUri });
  } catch (error: any) {
    console.error('[TTS API] Error:', error.message || error);
    return apiError(error.message || 'TTS failed', { status: 500, code: 'TTS_FAILED' });
  }
}
