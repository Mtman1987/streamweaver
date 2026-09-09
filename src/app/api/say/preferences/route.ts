import { NextRequest } from 'next/server';
import { apiError, apiOk } from '@/lib/api-response';
import { getSpmtDiscordIdentity } from '@/lib/spmt-userinfo';
import { DEFAULT_TTS_VOICE, TTS_VOICE_OPTIONS } from '@/lib/tts-voices';
import { getSayVoicePreference, setSayVoicePreference } from '@/services/say-tts';

export const dynamic = 'force-dynamic';

function voiceCatalog() {
  return TTS_VOICE_OPTIONS.map((voice) => ({
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
      details: { voices: voiceCatalog(), defaultVoice: DEFAULT_TTS_VOICE },
    });
  }

  const voice = await getSayVoicePreference(identity.discordUserId, 'discord');
  return apiOk({
    identity: {
      discordUserId: identity.discordUserId,
      discordUsername: identity.discordUsername,
    },
    voice: voice || '',
    defaultVoice: DEFAULT_TTS_VOICE,
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
    const voice = await setSayVoicePreference(identity.discordUserId, body.voice, 'discord');
    return apiOk({
      saved: true,
      identity: {
        discordUserId: identity.discordUserId,
        discordUsername: identity.discordUsername,
      },
      voice: voice || '',
      defaultVoice: DEFAULT_TTS_VOICE,
      voices: voiceCatalog(),
    });
  } catch (error) {
    return apiError(error instanceof Error ? error.message : 'Could not save TTS voice', {
      status: 400,
      code: 'INVALID_TTS_VOICE',
    });
  }
}