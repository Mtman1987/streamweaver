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
    if (config.provider === 'openai') {
      if (!config.apiKey) throw new Error('No OpenAI API key configured');
      audioDataUri = await generateOpenAITTS(normalizedText, config.voice, config.apiKey);
    } else if (config.provider === 'gemini') {
      if (!config.apiKey) throw new Error('No Gemini API key configured');
      audioDataUri = await generateGeminiTTS(normalizedText, config.voice, config.apiKey);
    } else {
      if (!config.apiKey) throw new Error('No EdenAI API key configured');
      audioDataUri = await generateEdenAITTS(normalizedText, config.voice, config.apiKey);
    }
  } catch (err) {
    // If primary failed and it wasn't already Gemini, try Gemini before StreamElements
    const geminiKey = resolveTTSApiKey('gemini', tenantId);
    if (config.provider !== 'gemini' && geminiKey) {
      try {
        console.warn(`[TTS] ${config.provider} failed, trying Gemini fallback:`, (err as Error).message);
        audioDataUri = await generateGeminiTTS(normalizedText, 'Aoede', geminiKey);
      } catch (geminiErr) {
        console.warn(`[TTS] Gemini fallback failed, falling back to StreamElements:`, (geminiErr as Error).message);
        audioDataUri = await generateFallbackTTS(normalizedText);
      }
    } else {
      console.warn(`[TTS] ${config.provider} failed, falling back to StreamElements:`, (err as Error).message);
      audioDataUri = await generateFallbackTTS(normalizedText);
    }
  }

  return audioDataUri;
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


