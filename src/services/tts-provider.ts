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
import { GoogleGenAI } from '@google/genai';

export interface TTSConfig {
  provider: TTSProvider;
  voice: string;
  apiKey: string;
}

export const TTS_VOICES: Record<string, string[]> = {
  edenai: TTS_VOICE_OPTIONS.filter((v) => v.provider === 'edenai').map((v) => v.id),
};

function resolveTTSApiKey(provider: TTSProvider, tenantId?: string): string {
  const config = readUserConfigSync(tenantId);
  if (provider === 'openai') return config.OPENAI_API_KEY || process.env.OPENAI_API_KEY || '';
  if (provider === 'gemini') return config.GEMINI_API_KEY || process.env.GEMINI_API_KEY || '';
  return config.EDENAI_API_KEY || process.env.EDENAI_API_KEY || '';
}

export function getTTSConfig(tenantId?: string): TTSConfig {
  const config = readUserConfigSync(tenantId);
  const configuredProvider = normalizeTtsProvider(config.TTS_PROVIDER || process.env.TTS_PROVIDER);
  const provider = getProviderForVoice(config.TTS_VOICE, configuredProvider);
  const voice = normalizeTtsVoice(config.TTS_VOICE, provider);
  const apiKey = resolveTTSApiKey(provider, tenantId);
  return { provider, voice, apiKey };
}

let lastTTSCall = 0;
const TTS_RATE_LIMIT = 2000;
const TTS_FETCH_TIMEOUT_MS = 20_000;
const TTS_DOWNLOAD_TIMEOUT_MS = 30_000;
const TTS_AUTH_COOLDOWN_MS = 6 * 60 * 60 * 1000;
const TTS_QUOTA_COOLDOWN_MS = 15 * 60 * 1000;
const providerCooldowns = new Map<string, number>();

const FALLBACK_VOICES: Record<TTSProvider, string> = {
  gemini: 'Aoede',
  edenai: 'edenai:google:FEMALE',
  openai: 'openai:nova',
};

export function getTTSFallbackProviders(primary: TTSProvider): TTSProvider[] {
  return (['gemini', 'edenai', 'openai'] as TTSProvider[]).filter((provider) => provider !== primary);
}

export function getTTSProviderCooldownMs(error: unknown): number {
  const message = String((error as Error)?.message || error || '').toLowerCase();
  if (/\b(?:401|403)\b|api key not valid|key was reported as leaked|permission_denied/.test(message)) {
    return TTS_AUTH_COOLDOWN_MS;
  }
  if (/\b429\b|resource_exhausted|quota/.test(message)) {
    return TTS_QUOTA_COOLDOWN_MS;
  }
  return 0;
}

function providerCooldownKey(tenantId: string | undefined, provider: TTSProvider): string {
  return `${tenantId || 'global'}:${provider}`;
}

async function generateProviderTTS(provider: TTSProvider, text: string, voice: string, apiKey: string): Promise<string> {
  if (provider === 'openai') return generateOpenAITTS(text, voice, apiKey);
  if (provider === 'gemini') return generateGeminiTTS(text, voice, apiKey);
  return generateEdenAITTS(text, voice, apiKey);
}

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

  const attempts = [
    { provider: config.provider, voice: config.voice, apiKey: config.apiKey },
    ...getTTSFallbackProviders(config.provider).map((provider) => ({
      provider,
      voice: FALLBACK_VOICES[provider],
      apiKey: resolveTTSApiKey(provider, tenantId),
    })),
  ];

  for (const [index, attempt] of attempts.entries()) {
    if (!attempt.apiKey) continue;
    const cooldownKey = providerCooldownKey(tenantId, attempt.provider);
    if ((providerCooldowns.get(cooldownKey) || 0) > Date.now()) continue;
    try {
      return await generateProviderTTS(attempt.provider, normalizedText, attempt.voice, attempt.apiKey);
    } catch (error) {
      const cooldownMs = getTTSProviderCooldownMs(error);
      if (cooldownMs) providerCooldowns.set(cooldownKey, Date.now() + cooldownMs);
      const nextProvider = attempts.slice(index + 1).find((candidate) => Boolean(candidate.apiKey))?.provider;
      console.warn(
        `[TTS] ${attempt.provider} failed${nextProvider ? `, trying ${nextProvider} fallback` : ', trying legacy fallback'}:`,
        (error as Error).message,
      );
    }
  }

  return generateFallbackTTS(normalizedText);
}

async function generateGeminiTTS(text: string, voice: string, apiKey: string): Promise<string> {
  const voiceName = voice.replace(/^gemini:/i, '') || 'Aoede';
  const ai = new GoogleGenAI({ apiKey });
  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash-preview-tts',
    contents: [{ parts: [{ text }] }],
    config: {
      responseModalities: ['AUDIO'],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } },
    },
  });
  const audioData = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  if (!audioData) throw new Error('Gemini TTS returned no audio data');
  return `data:audio/wav;base64,${audioData}`;
}

async function generateOpenAITTS(text: string, voice: string, apiKey: string): Promise<string> {
  const voiceName = voice.replace(/^openai:/, '') || 'nova';
  const response = await fetchWithRetry('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model: 'tts-1', voice: voiceName, input: text }),
  }, { timeoutMs: TTS_DOWNLOAD_TIMEOUT_MS });
  if (!response.ok) {
    const errBody = await response.text().catch(() => '');
    throw new Error(`OpenAI TTS failed: ${response.status} ${errBody}`);
  }
  const audioBuffer = await response.arrayBuffer();
  return `data:audio/mpeg;base64,${Buffer.from(audioBuffer).toString('base64')}`;
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

async function generateFallbackTTS(text: string): Promise<string> {
  // StreamElements TTS — free, no API key, natural sounding
  const url = `https://api.streamelements.com/kappa/v2/speech?voice=Brian&text=${encodeURIComponent(text.slice(0, 300))}`;
  const response = await fetchWithRetry(url, {}, { timeoutMs: TTS_DOWNLOAD_TIMEOUT_MS });
  if (!response.ok) throw new Error(`Fallback TTS failed: ${response.status}`);
  const audioBuffer = await response.arrayBuffer();
  return `data:audio/mpeg;base64,${Buffer.from(audioBuffer).toString('base64')}`;
}


