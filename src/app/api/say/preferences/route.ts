import { NextRequest } from 'next/server';
import { apiError, apiOk } from '@/lib/api-response';
import { getSpmtDiscordIdentity } from '@/lib/spmt-userinfo';
import { DEFAULT_TTS_VOICE, TTS_VOICE_OPTIONS } from '@/lib/tts-voices';
import { readAICostPolicy } from '@/services/ai-cost-policy';
import { getSayVoicePreference, setSayVoicePreference } from '@/services/say-tts';

export const dynamic = 'force-dynamic';

function effectiveDefaultVoice(): string {
  const policy = readAICostPolicy();
  if (policy.paidRoutesEnabled) return DEFAULT_TTS_VOICE;
  return policy.geminiFreeTierVerified ? 'gemini:kore:natural' : 'kokoro:af_heart';
}

function voiceCatalog() {
  const policy = readAICostPolicy();
  const available = policy.paidRoutesEnabled
    ? TTS_VOICE_OPTIONS
    : TTS_VOICE_OPTIONS.filter((voice) => voice.provider === 'kokoro' || (policy.geminiFreeTierVerified && voice.provider === 'gemini'));
  return available.map((voice) => ({
    id: voice.id,
    label: voice.label,
    provider: voice.providerLabel,
    gender: voice.gender,
    description: voice.description,
  }));
}

export async function GET(request: NextRequest) {
  const identity = await getSpmtDiscordIdentity(request).catch(() => null);
  if (!identity) {
    return apiError('Sign in with your linked SPMT/Discord account to choose your public TTS voice.', {
      status: 401,
      code: 'DISCORD_IDENTITY_REQUIRED',
      details: { voices: voiceCatalog(), defaultVoice: effectiveDefaultVoice() },
    });
  }

  const voice = await getSayVoicePreference(identity.discordUserId, 'discord');
  return apiOk({
    identity: {
      discordUserId: identity.discordUserId,
      discordUsername: identity.discordUsername,
    },
    voice: voice || '',
    defaultVoice: effectiveDefaultVoice(),
    voices: voiceCatalog(),
  });
}

export async function POST(request: NextRequest) {
  const identity = await getSpmtDiscordIdentity(request).catch(() => null);
  if (!identity) {
    return apiError('Sign in with your linked SPMT/Discord account to choose your public TTS voice.', {
      status: 401,
      code: 'DISCORD_IDENTITY_REQUIRED',
    });
  }

  const body = await request.json().catch(() => ({})) as { voice?: unknown };
  try {
    const requestedVoice = String(body.voice || '').trim();
    if (requestedVoice && !voiceCatalog().some((option) => option.id === requestedVoice)) {
      throw new Error('That voice is not enabled under the current free-only speech policy. Choose Kokoro or a verified-free Gemini voice.');
    }
    const voice = await setSayVoicePreference(identity.discordUserId, requestedVoice, 'discord');
    return apiOk({
      saved: true,
      identity: {
        discordUserId: identity.discordUserId,
        discordUsername: identity.discordUsername,
      },
      voice: voice || '',
      defaultVoice: effectiveDefaultVoice(),
      voices: voiceCatalog(),
    });
  } catch (error) {
    return apiError(error instanceof Error ? error.message : 'Could not save TTS voice', {
      status: 400,
      code: 'INVALID_TTS_VOICE',
    });
  }
}