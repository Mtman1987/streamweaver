import { readUserConfigSync } from '@/lib/user-config';
import { normalizeTextForTTS } from '@/lib/tts-text';
import {
  TTS_VOICE_OPTIONS,
  TTSProvider,
  getTtsVoiceOption,
  getProviderForVoice,
  normalizeTtsProvider,
  normalizeTtsVoice,
} from '@/lib/tts-voices';

export interface TTSConfig {
  provider: TTSProvider;
  voice: string;
  apiKey: string;
  discordBridge: boolean;
}

export const TTS_VOICES: Record<TTSProvider, string[]> = {
  edenai: TTS_VOICE_OPTIONS.filter((v) => v.provider === 'edenai').map((v) => v.id),
  google: TTS_VOICE_OPTIONS.filter((v) => v.provider === 'google').map((v) => v.id),
};

function resolveTTSApiKey(provider: TTSProvider, tenantId?: string): string {
  const config = readUserConfigSync(tenantId);
  if (provider === 'edenai') return config.EDENAI_API_KEY || process.env.EDENAI_API_KEY || '';
  if (provider === 'google') return config.GOOGLE_TTS_API_KEY || process.env.GOOGLE_TTS_API_KEY || '';
  return '';
}

export function getTTSConfig(tenantId?: string): TTSConfig {
  const config = readUserConfigSync(tenantId);
  const configuredProvider = normalizeTtsProvider(config.TTS_PROVIDER || process.env.TTS_PROVIDER);
  const provider = getProviderForVoice(config.TTS_VOICE, configuredProvider);
  const voice = normalizeTtsVoice(config.TTS_VOICE, provider);
  const discordBridge = config.DISCORD_TTS_BRIDGE === 'true';
  const apiKey = resolveTTSApiKey(provider, tenantId);
  return { provider, voice, apiKey, discordBridge };
}

let lastTTSCall = 0;
const TTS_RATE_LIMIT = 2000;
const TTS_FETCH_TIMEOUT_MS = 20_000;
const TTS_DOWNLOAD_TIMEOUT_MS = 30_000;

async function fetchWithRetry(
  input: string,
  init: RequestInit,
  options: { attempts?: number; timeoutMs?: number } = {},
): Promise<Response> {
  const attempts = options.attempts ?? 2;
  const timeoutMs = options.timeoutMs ?? TTS_FETCH_TIMEOUT_MS;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(input, { ...init, signal: controller.signal });
      if (response.ok || attempt === attempts) return response;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
      if (attempt === attempts) break;
    } finally {
      clearTimeout(timeout);
    }
    await new Promise((r) => setTimeout(r, attempt * 1000));
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export async function generateTTS(text: string, voiceOverride?: string, tenantId?: string): Promise<string> {
  const normalizedText = normalizeTextForTTS(text);
  if (!normalizedText) return '';

  // Rate limiting
  const now = Date.now();
  if (now - lastTTSCall < TTS_RATE_LIMIT) {
    await new Promise((r) => setTimeout(r, TTS_RATE_LIMIT - (now - lastTTSCall)));
  }
  lastTTSCall = Date.now();

  const baseConfig = getTTSConfig(tenantId);
  const selectedProvider = voiceOverride ? getProviderForVoice(voiceOverride, baseConfig.provider) : baseConfig.provider;
  const config: TTSConfig = voiceOverride
    ? { ...baseConfig, provider: selectedProvider, voice: normalizeTtsVoice(voiceOverride, selectedProvider), apiKey: resolveTTSApiKey(selectedProvider, tenantId) }
    : baseConfig;

  let audioDataUri: string;

  try {
    if (config.provider === 'google') {
      audioDataUri = await generateGoogleCloudTTS(normalizedText, config.voice, config.apiKey);
    } else {
      if (!config.apiKey) throw new Error('No EdenAI API key configured');
      audioDataUri = await generateEdenAITTS(normalizedText, config.voice, config.apiKey);
    }
  } catch (err) {
    // Fallback: direct Google Cloud TTS
    const googleKey = resolveTTSApiKey('google', tenantId);
    if (!googleKey) throw err;
    console.warn(`[TTS] EdenAI failed, falling back to Google Cloud TTS:`, (err as Error).message);
    audioDataUri = await generateGoogleCloudTTS(normalizedText, config.voice, googleKey);
  }

  if (config.discordBridge) {
    sendToDiscordBridge(audioDataUri, normalizedText, config.voice).catch((e) => console.warn('[TTS] Discord bridge failed:', e));
  }

  return audioDataUri;
}

async function generateEdenAITTS(text: string, voice: string, apiKey: string): Promise<string> {
  const voiceOption = getTtsVoiceOption(voice, 'edenai');
  const edenaiProvider = voiceOption.edenaiProvider || 'google';
  const edenaiOption = voiceOption.edenaiOption || (voiceOption.gender === 'Female' ? 'FEMALE' : 'MALE');

  const response = await fetchWithRetry('https://api.edenai.run/v2/audio/text_to_speech', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      providers: edenaiProvider,
      language: 'en',
      text,
      option: edenaiOption,
    }),
  });

  if (!response.ok) {
    const errBody = await response.text().catch(() => '');
    throw new Error(`EdenAI TTS failed: ${response.status} ${errBody}`);
  }

  const result = await response.json();
  const providerResult = result?.[edenaiProvider] || Object.values(result || {}).find((v: any) => v?.audio_resource_url);
  const audioUrl = (providerResult as any)?.audio_resource_url;
  if (!audioUrl) throw new Error(`EdenAI TTS returned no audio for ${edenaiProvider}`);

  const audioRes = await fetchWithRetry(audioUrl, {}, { timeoutMs: TTS_DOWNLOAD_TIMEOUT_MS });
  if (!audioRes.ok) throw new Error(`EdenAI audio download failed: ${audioRes.status}`);

  const audioBuffer = await audioRes.arrayBuffer();
  return `data:audio/mpeg;base64,${Buffer.from(audioBuffer).toString('base64')}`;
}

async function generateGoogleCloudTTS(text: string, voice: string, apiKey: string): Promise<string> {
  const voiceOption = getTtsVoiceOption(voice, 'google');
  const googleVoice = voiceOption.googleVoice || 'en-US-Wavenet-F';

  const response = await fetchWithRetry(
    `https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input: { text },
        voice: { languageCode: 'en-US', name: googleVoice },
        audioConfig: { audioEncoding: 'MP3' },
      }),
    },
  );

  if (!response.ok) {
    const errBody = await response.text().catch(() => '');
    throw new Error(`Google Cloud TTS failed: ${response.status} ${errBody}`);
  }

  const result = await response.json();
  const audioContent = result?.audioContent;
  if (!audioContent) throw new Error('Google Cloud TTS returned no audio');

  return `data:audio/mpeg;base64,${audioContent}`;
}

async function sendToDiscordBridge(audioDataUri: string, text: string, voice: string): Promise<void> {
  await fetch('http://localhost:8090/discord-tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'discord-tts', payload: { audioDataUri, text, voice } }),
  });
}
