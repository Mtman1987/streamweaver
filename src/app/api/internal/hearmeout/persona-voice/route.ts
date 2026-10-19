import { NextRequest } from 'next/server';
import { apiError, apiOk } from '@/lib/api-response';
import { hasInternalServiceAccess } from '@/lib/internal-service-auth';
import { getBotSettings, reloadBotSettings, setBotSettings } from '@/lib/bot-settings-store';
import { generateFreeTTS } from '@/services/free-tts';
import { getTtsVoiceOption, KOKORO_VOICE_OPTIONS, normalizeTtsVoice } from '@/lib/tts-voices';
import { writeUserConfig } from '@/lib/user-config';

export const dynamic = 'force-dynamic';

function catalog() {
  return KOKORO_VOICE_OPTIONS.map(({ id, label, gender, description }) => ({ id, label, gender, description }));
}

export async function GET(request: NextRequest) {
  if (!hasInternalServiceAccess(request)) return apiError('Unauthorized', { status: 401, code: 'UNAUTHORIZED' });
  const tenantId = String(request.nextUrl.searchParams.get('tenantId') || '').trim().slice(0, 128);
  if (!tenantId) return apiError('tenantId is required', { status: 400, code: 'INVALID_TENANT' });
  const settings = getBotSettings(tenantId);
  const voice = normalizeTtsVoice(settings.voice);
  return apiOk({ voices: catalog(), voice });
}

export async function POST(request: NextRequest) {
  if (!hasInternalServiceAccess(request)) return apiError('Unauthorized', { status: 401, code: 'UNAUTHORIZED' });
  const body = await request.json().catch(() => null) as any;
  const tenantId = String(body?.tenantId || '').trim().slice(0, 128);
  const action = String(body?.action || '').trim().toLowerCase();
  const requested = String(body?.voice || '').trim();
  if (!tenantId || !requested) return apiError('tenantId and voice are required', { status: 400, code: 'INVALID_REQUEST' });
  const voice = normalizeTtsVoice(requested);
  const option = getTtsVoiceOption(voice);
  if (!KOKORO_VOICE_OPTIONS.some((entry) => entry.id === voice) || option.provider !== 'kokoro') {
    return apiError('Only the free Kokoro voice catalog is available here.', { status: 400, code: 'VOICE_NOT_ALLOWED' });
  }

  if (action === 'save') {
    const settings = getBotSettings(tenantId);
    setBotSettings(tenantId, { voice });
    await writeUserConfig({ TTS_VOICE: voice }, tenantId);
    reloadBotSettings(tenantId);
    return apiOk({ saved: true, voice, previousVoice: settings.voice });
  }

  if (action === 'test') {
    const audioDataUri = await generateFreeTTS('Hello! This is a quick voice test. How does this voice sound to you?', voice.replace(/^kokoro:/, ''));
    if (!audioDataUri) return apiError('This voice could not be generated right now. Check that the local Kokoro worker is healthy and try again.', { status: 503, code: 'VOICE_TEST_FAILED' });
    return apiOk({ audioDataUri, voice });
  }

  return apiError('action must be save or test', { status: 400, code: 'INVALID_ACTION' });
}
