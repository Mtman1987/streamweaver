import { createHash } from 'node:crypto';
import { readUserConfigSync } from '@/lib/user-config';
import { normalizeTextForTTS } from '@/lib/tts-text';
import {
  TTS_VOICE_OPTIONS,
  ATHENA_CANONICAL_TTS_VOICE,
  ATHENA_DEEPGRAM_TTS_MODEL,
  ATHENA_TENANT_ID,
  type TTSProvider,
  type TTSVoiceOption,
  getTtsVoiceOption,
  normalizeTtsVoice,
} from '@/lib/tts-voices';
import {
  hasActiveTtsConsumer,
  type TtsConsumerScope,
} from '@/services/tts-consumer-presence';

export interface TTSConfig {
  provider: TTSProvider;
  voice: string;
  apiKey: string;
  deepgramApiKey: string;
}

export type GenerateTTSOptions = {
  requireActiveConsumer?: boolean;
  consumerScope?: TtsConsumerScope;
};

export const TTS_VOICES: Record<TTSProvider, string[]> = {
  edenai: TTS_VOICE_OPTIONS.filter((voice) => voice.provider === 'edenai').map((voice) => voice.id),
  deepgram: TTS_VOICE_OPTIONS.filter((voice) => voice.provider === 'deepgram').map((voice) => voice.id),
};

function resolveTTSApiKey(tenantId?: string): string {
  const config = readUserConfigSync(tenantId);
  return config.EDENAI_API_KEY || process.env.EDENAI_API_KEY || '';
}

export function getTTSConfig(tenantId?: string): TTSConfig {
  const config = readUserConfigSync(tenantId);
  const voice = tenantId === ATHENA_TENANT_ID
    ? ATHENA_CANONICAL_TTS_VOICE
    : normalizeTtsVoice(config.TTS_VOICE);
  return {
    provider: getTtsVoiceOption(voice).provider,
    voice,
    apiKey: resolveTTSApiKey(tenantId),
    deepgramApiKey: config.DEEPGRAM_API_KEY || process.env.DEEPGRAM_API_KEY || '',
  };
}

let lastTTSCall = 0;
const TTS_RATE_LIMIT_MS = 2_000;
const TTS_FETCH_TIMEOUT_MS = 20_000;
const TTS_DOWNLOAD_TIMEOUT_MS = 30_000;
const TTS_AUTH_COOLDOWN_MS = 6 * 60 * 60 * 1000;
const TTS_QUOTA_COOLDOWN_MS = 15 * 60 * 1000;
const voiceCooldowns = new Map<string, number>();
const speechRouteCooldowns = new Map<string, number>();

export function getTTSProviderCooldownMs(error: unknown): number {
  const message = String((error as Error)?.message || error || '').toLowerCase();
  if (/\b(?:401|403)\b|api key not valid|key was reported as leaked|permission_denied/.test(message)) {
    return TTS_AUTH_COOLDOWN_MS;
  }
  if (/\b(?:402|429)\b|resource_exhausted|quota|insufficient_credit/.test(message)) {
    return TTS_QUOTA_COOLDOWN_MS;
  }
  return 0;
}

export function getLifelikeFallbackVoices(selectedVoice: string): string[] {
  const selected = getTtsVoiceOption(selectedVoice);
  if (selected.id === ATHENA_CANONICAL_TTS_VOICE || selected.provider === 'deepgram') return [];
  const preferredProviders = selected.gender === 'Male'
    ? ['openai', 'microsoft', 'amazon', 'google']
    : ['openai', 'google', 'microsoft', 'amazon'];

  return preferredProviders
    .map((provider) => TTS_VOICE_OPTIONS.find((voice) => (
      voice.provider === 'edenai'
      && voice.gender === selected.gender
      && voice.edenaiProvider === provider
      && voice.id !== selected.id
    )))
    .filter((voice): voice is TTSVoiceOption => Boolean(voice))
    .slice(0, 3)
    .map((voice) => voice.id);
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
    await new Promise((resolve) => setTimeout(resolve, attempt * 1_000));
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export async function generateTTS(
  text: string,
  voiceOverride?: string,
  tenantId?: string,
  options: GenerateTTSOptions = {},
): Promise<string> {
  const normalizedText = normalizeTextForTTS(text);
  if (!normalizedText) return '';

  if (options.requireActiveConsumer && !hasActiveTtsConsumer(tenantId, options.consumerScope || 'overlay')) {
    console.log(`[TTS] Skipped paid synthesis for ${tenantId || 'global'}: no active ${options.consumerScope || 'overlay'} listener`);
    return '';
  }

  const now = Date.now();
  if (now - lastTTSCall < TTS_RATE_LIMIT_MS) {
    await new Promise((resolve) => setTimeout(resolve, TTS_RATE_LIMIT_MS - (now - lastTTSCall)));
  }
  lastTTSCall = Date.now();

  const config = getTTSConfig(tenantId);
  const selectedVoice = tenantId === ATHENA_TENANT_ID
    ? ATHENA_CANONICAL_TTS_VOICE
    : normalizeTtsVoice(voiceOverride || config.voice);
  const attempts = [selectedVoice, ...getLifelikeFallbackVoices(selectedVoice)];
  const errors: string[] = [];

  for (const voiceId of attempts) {
    const voice = getTtsVoiceOption(voiceId);
    const cooldownKey = `${tenantId || 'global'}:${voiceId}`;
    if (voice.provider !== 'deepgram' && (voiceCooldowns.get(cooldownKey) || 0) > Date.now()) continue;
    try {
      if (voice.provider === 'deepgram') {
        return await generatePortableDeepgramTTS(normalizedText, voice, config, tenantId);
      }
      if (!config.apiKey) throw new Error('Eden AI TTS is not configured');
      return await generateEdenAITTS(normalizedText, voice, config.apiKey);
    } catch (error) {
      const cooldownMs = getTTSProviderCooldownMs(error);
      if (cooldownMs && voice.provider !== 'deepgram') voiceCooldowns.set(cooldownKey, Date.now() + cooldownMs);
      const message = (error as Error).message;
      errors.push(`${voiceId}: ${message}`);
      console.warn(`[TTS] Voice ${voiceId} failed${attempts.length > 1 ? '; trying the next same-gender named voice' : ''}:`, message);
    }
  }

  throw new Error(`Lifelike TTS failed; cross-voice fallback is disabled for pinned voices. ${errors.join(' | ')}`);
}

async function generatePortableDeepgramTTS(text: string, voice: TTSVoiceOption, config: TTSConfig, tenantId?: string): Promise<string> {
  // Provider failover preserves the exact model/speaker. Direct Deepgram uses
  // the account's credits first; Eden AI supplies that same voice on failure.
  const routes = [
    { name: 'Deepgram', key: config.deepgramApiKey, synthesize: () => generateDeepgramTTS(text, config.deepgramApiKey, voice.deepgramModel) },
    { name: 'Eden AI', key: config.apiKey, synthesize: () => generateEdenAIDeepgramTTS(text, voice, config.apiKey) },
  ];
  const failures: string[] = [];
  for (const route of routes) {
    if (!route.key) continue;
    // A replacement credential can recover immediately. Never store or log the
    // credential itself, and never let one provider's outage disable the other.
    const revision = createHash('sha256').update(route.key).digest('hex');
    const cooldownKey = `${tenantId || 'global'}:${voice.id}:${route.name}:${revision}`;
    if ((speechRouteCooldowns.get(cooldownKey) || 0) > Date.now()) {
      failures.push(`${route.name} is temporarily cooling down`);
      continue;
    }
    speechRouteCooldowns.delete(cooldownKey);
    try {
      return await route.synthesize();
    } catch (error) {
      const cooldownMs = getTTSProviderCooldownMs(error) || 30_000;
      speechRouteCooldowns.set(cooldownKey, Date.now() + cooldownMs);
      const message = error instanceof Error ? error.message : 'Speech request failed';
      failures.push(`${route.name}: ${message}`);
      console.warn(`[TTS] ${route.name} failed for ${voice.id}; retaining the same voice: ${message}`);
    }
  }
  throw new Error(failures.join(' | ') || 'No Deepgram or Eden AI speech credential is configured');
}

export async function generateDeepgramTTS(text: string, apiKey: string, model = ATHENA_DEEPGRAM_TTS_MODEL): Promise<string> {
  const response = await fetchWithRetry(
    `https://api.deepgram.com/v1/speak?model=${encodeURIComponent(model || ATHENA_DEEPGRAM_TTS_MODEL)}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Token ${apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify({ text }),
    },
    { attempts: 1 },
  );
  if (!response.ok) {
    throw new Error(`Deepgram TTS failed: ${response.status}`);
  }
  const contentType = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (contentType && !contentType.startsWith('audio/') && !['application/octet-stream', 'binary/octet-stream'].includes(contentType)) {
    throw new Error('Deepgram TTS returned non-audio content');
  }
  const audioBuffer = await response.arrayBuffer();
  if (!audioBuffer.byteLength) throw new Error('Deepgram TTS returned empty audio');
  return `data:audio/mpeg;base64,${Buffer.from(audioBuffer).toString('base64')}`;
}

async function generateEdenAIDeepgramTTS(text: string, voice: TTSVoiceOption, apiKey: string): Promise<string> {
  if (!voice.deepgramModel?.startsWith('aura-2-')) {
    throw new Error(`Unsupported Eden AI Deepgram voice: ${voice.id}`);
  }
  const response = await fetchWithRetry('https://api.edenai.run/v3/universal-ai', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'audio/tts/deepgram/aura-2',
      input: { text, voice: voice.deepgramModel, audio_format: 'mp3' },
    }),
  });
  if (!response.ok) throw new Error(`Eden AI Deepgram TTS failed: ${response.status}`);

  const result = await response.json();
  if (result?.status !== 'success' || result?.provider !== 'deepgram') {
    throw new Error(`Eden AI did not generate the selected Deepgram voice: ${voice.id}`);
  }
  const audioUrl = result?.output?.audio_resource_url;
  if (typeof audioUrl !== 'string' || !audioUrl) throw new Error(`Eden AI returned no audio for ${voice.id}`);
  const audioResponse = await fetchWithRetry(audioUrl, {}, { timeoutMs: TTS_DOWNLOAD_TIMEOUT_MS });
  if (!audioResponse.ok) throw new Error(`Eden AI audio download failed: ${audioResponse.status}`);
  const contentType = (audioResponse.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (contentType && !contentType.startsWith('audio/') && !['application/octet-stream', 'binary/octet-stream'].includes(contentType)) {
    throw new Error('Eden AI returned a non-audio download');
  }
  const audioBuffer = await audioResponse.arrayBuffer();
  if (!audioBuffer.byteLength) throw new Error('Eden AI returned empty audio');
  return `data:audio/mpeg;base64,${Buffer.from(audioBuffer).toString('base64')}`;
}

async function generateEdenAITTS(text: string, voice: TTSVoiceOption, apiKey: string): Promise<string> {
  const response = await fetchWithRetry('https://api.edenai.run/v2/audio/text_to_speech', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      providers: voice.edenaiProvider,
      language: 'en',
      text,
      option: voice.edenaiOption,
      audio_format: 'mp3',
      settings: {
        [voice.edenaiProvider]: voice.edenaiVoiceModel,
      },
    }),
  });

  if (!response.ok) {
    const errBody = await response.text().catch(() => '');
    throw new Error(`Eden AI TTS failed: ${response.status} ${errBody}`);
  }

  const result = await response.json();
  const providerResult = result?.[voice.edenaiProvider]
    || Object.values(result || {}).find((value: any) => value?.audio_resource_url || value?.error);
  const providerError = (providerResult as any)?.error;
  if (providerError) {
    const message = typeof providerError === 'string'
      ? providerError
      : providerError.message || JSON.stringify(providerError);
    throw new Error(`${voice.providerLabel} failed: ${message}`);
  }

  const audioUrl = (providerResult as any)?.audio_resource_url;
  if (!audioUrl) throw new Error(`Eden AI returned no audio for ${voice.id}`);

  const audioResponse = await fetchWithRetry(audioUrl, {}, { timeoutMs: TTS_DOWNLOAD_TIMEOUT_MS });
  if (!audioResponse.ok) throw new Error(`Eden AI audio download failed: ${audioResponse.status}`);

  const audioBuffer = await audioResponse.arrayBuffer();
  return `data:audio/mpeg;base64,${Buffer.from(audioBuffer).toString('base64')}`;
}
