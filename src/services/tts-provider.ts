import { mkdir, readFile, rm, stat, writeFile } from 'fs/promises';
import { basename, dirname, join, resolve } from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { readUserConfigSync } from '@/lib/user-config';
import { normalizeTextForTTS } from '@/lib/tts-text';
import {
  TTS_VOICE_OPTIONS,
  TTSProvider,
  getFallbackVoiceForProvider,
  getProviderForVoice,
  getTtsVoiceOption,
  normalizePiperVoice,
  normalizeTtsProvider,
  normalizeTtsVoice,
} from '@/lib/tts-voices';

const execFileAsync = promisify(execFile);

export interface TTSConfig {
  provider: TTSProvider;
  voice: string;
  apiKey: string;
  discordBridge: boolean;
}

export const TTS_VOICES: Record<TTSProvider, string[]> = {
  piper: TTS_VOICE_OPTIONS.filter((voice) => voice.provider === 'piper').map((voice) => voice.id),
  edenai: TTS_VOICE_OPTIONS.filter((voice) => voice.provider === 'edenai').map((voice) => voice.id),
  openai: TTS_VOICE_OPTIONS.filter((voice) => voice.provider === 'openai').map((voice) => voice.id),
};

function normalizeProvider(provider: unknown): TTSProvider {
  return normalizeTtsProvider(provider);
}

function resolveTTSApiKey(provider: TTSProvider, tenantId?: string): string {
  const config = readUserConfigSync(tenantId);
  if (provider === 'edenai') return config.EDENAI_API_KEY || process.env.EDENAI_API_KEY || '';
  if (provider === 'openai') return config.OPENAI_API_KEY || process.env.OPENAI_API_KEY || '';
  return '';
}

export function getTTSConfig(tenantId?: string): TTSConfig {
  const config = readUserConfigSync(tenantId);
  
  const configuredProvider = normalizeProvider(config.TTS_PROVIDER || process.env.TTS_PROVIDER);
  const provider = getProviderForVoice(config.TTS_VOICE, configuredProvider);
  const voice = normalizeTtsVoice(config.TTS_VOICE, provider);
  const discordBridge = config.DISCORD_TTS_BRIDGE === 'true';
  console.log('[TTS Config] provider:', provider, '| voice:', voice, '| discordBridge:', discordBridge);
  
  const apiKey = resolveTTSApiKey(provider, tenantId);
  
  console.log('[TTS Config] apiKey present:', !!apiKey, '| length:', apiKey.length);
  return { provider, voice, apiKey, discordBridge };
}

let lastTTSCall = 0;
const TTS_RATE_LIMIT = 2000; // 2 seconds between TTS calls
const TTS_FETCH_TIMEOUT_MS = 20_000;
const TTS_DOWNLOAD_TIMEOUT_MS = 30_000;

async function fetchWithRetry(
  input: string,
  init: RequestInit,
  options: { attempts?: number; timeoutMs?: number; retryOnStatuses?: number[] } = {},
): Promise<Response> {
  const attempts = options.attempts ?? 2;
  const timeoutMs = options.timeoutMs ?? TTS_FETCH_TIMEOUT_MS;
  const retryOnStatuses = new Set(options.retryOnStatuses ?? [408, 425, 429, 500, 502, 503, 504]);
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(input, { ...init, signal: controller.signal });
      if (response.ok || !retryOnStatuses.has(response.status) || attempt === attempts) {
        return response;
      }

      const body = await response.text().catch(() => '');
      lastError = new Error(`HTTP ${response.status} ${body}`);
    } catch (error) {
      lastError = error;
      if (attempt === attempts) break;
    } finally {
      clearTimeout(timeout);
    }

    await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError ?? 'fetch failed'));
}

export async function generateTTS(text: string, voiceOverride?: string, tenantId?: string): Promise<string> {
  const normalizedText = normalizeTextForTTS(text);
  console.log('[TTS] generateTTS called | voiceOverride:', voiceOverride ?? '(none)', '| textLength:', text.length, '| normalizedLength:', normalizedText.length);

  if (!normalizedText) {
    console.log('[TTS] Skipping empty text after normalization');
    return '';
  }
  
  // Rate limiting to prevent 429 errors
  const now = Date.now();
  const timeSinceLastCall = now - lastTTSCall;
  if (timeSinceLastCall < TTS_RATE_LIMIT) {
    const waitTime = TTS_RATE_LIMIT - timeSinceLastCall;
    console.log('[TTS] Rate limited, waiting', waitTime, 'ms');
    await new Promise(resolve => setTimeout(resolve, waitTime));
  }
  lastTTSCall = Date.now();
  
  const baseConfig = getTTSConfig(tenantId);
  const selectedProvider = voiceOverride ? getProviderForVoice(voiceOverride, baseConfig.provider) : baseConfig.provider;
  const config: TTSConfig = voiceOverride
    ? { ...baseConfig, provider: selectedProvider, voice: normalizeTtsVoice(voiceOverride, selectedProvider), apiKey: resolveTTSApiKey(selectedProvider, tenantId) }
    : baseConfig;
  
  console.log('[TTS] Final config | provider:', config.provider, '| voice:', config.voice, '| hasKey:', !!config.apiKey);
  
  let audioDataUri: string;
  
  try {
    switch (config.provider) {
      case 'openai':
        if (!config.apiKey) {
          throw new Error(`No API key configured for ${config.provider} TTS`);
        }
        audioDataUri = await generateOpenAITTS(normalizedText, config.voice, config.apiKey);
        break;
      case 'edenai':
        if (!config.apiKey) {
          throw new Error(`No API key configured for ${config.provider} TTS`);
        }
        audioDataUri = await generateEdenAITTS(normalizedText, config.voice, config.apiKey);
        break;
      default:
        audioDataUri = await generatePiperTTS(normalizedText, config.voice);
        break;
    }
  } catch (err) {
    if (config.provider === 'edenai') {
      const fallbackVoice = getFallbackVoiceForProvider('edenai', config.voice);
      console.warn(`[TTS] EdenAI failed (voice: ${config.voice}), falling back to Piper ${fallbackVoice}:`, (err as Error).message);
      audioDataUri = await generatePiperTTS(normalizedText, fallbackVoice);
    } else if (config.provider === 'openai') {
      const edenKey = resolveTTSApiKey('edenai', tenantId);
      if (edenKey) {
        const fallbackVoice = getFallbackVoiceForProvider('openai', config.voice);
        console.warn(`[TTS] OpenAI failed (voice: ${config.voice}), falling back to EdenAI ${fallbackVoice}:`, (err as Error).message);
        audioDataUri = await generateEdenAITTS(normalizedText, fallbackVoice, edenKey);
      } else {
        const fallbackVoice = getFallbackVoiceForProvider('edenai', config.voice);
        console.warn(`[TTS] OpenAI failed (voice: ${config.voice}), falling back to Piper ${fallbackVoice}:`, (err as Error).message);
        audioDataUri = await generatePiperTTS(normalizedText, fallbackVoice);
      }
    } else {
      const edenKey = resolveTTSApiKey('edenai', tenantId);
      if (!edenKey) {
        throw err;
      }
      const fallbackVoice = getFallbackVoiceForProvider('piper', config.voice);
      console.warn(`[TTS] Piper failed (voice: ${config.voice}), falling back to EdenAI ${fallbackVoice}:`, (err as Error).message);
      audioDataUri = await generateEdenAITTS(normalizedText, fallbackVoice, edenKey);
    }
  }
  
  console.log('[TTS] Audio generated | provider:', config.provider, '| voice:', config.voice, '| dataUri length:', audioDataUri.length);
  
  // Send to Discord if bridge is enabled
  if (config.discordBridge) {
    try {
      await sendToDiscordBridge(audioDataUri, normalizedText, config.voice);
    } catch (error) {
      console.warn('Discord bridge failed:', error);
    }
  }
  
  return audioDataUri;
}

async function generateOpenAITTS(text: string, voice: string, apiKey: string): Promise<string> {
  const voiceOption = getTtsVoiceOption(voice, 'openai');
  const openaiVoice = voiceOption.openaiVoice || 'nova';
  const response = await fetchWithRetry('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: process.env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts',
      input: text,
      voice: openaiVoice,
      response_format: 'mp3',
    }),
  }, { attempts: 2, timeoutMs: TTS_FETCH_TIMEOUT_MS });

  if (!response.ok) {
    const errBody = await response.text().catch(() => '');
    throw new Error(`OpenAI TTS failed: ${response.status} ${errBody}`);
  }

  const audioBuffer = await response.arrayBuffer();
  return `data:audio/mpeg;base64,${Buffer.from(audioBuffer).toString('base64')}`;
}

async function generateEdenAITTS(text: string, voice: string, apiKey: string): Promise<string> {
  const voiceOption = getTtsVoiceOption(voice, 'edenai');
  const edenaiProvider = voiceOption.edenaiProvider || 'openai';
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
  }, { attempts: 2, timeoutMs: TTS_FETCH_TIMEOUT_MS });

  if (!response.ok) {
    const errBody = await response.text().catch(() => '');
    throw new Error(`EdenAI TTS failed: ${response.status} ${errBody}`);
  }

  const result = await response.json();
  const providerResult = result?.[edenaiProvider] || Object.values(result || {}).find((value: any) => value?.audio_resource_url);
  const audioUrl = (providerResult as any)?.audio_resource_url;
  if (!audioUrl) {
    throw new Error(`EdenAI TTS returned no audio for ${edenaiProvider}`);
  }

  const audioRes = await fetchWithRetry(audioUrl, {}, { attempts: 2, timeoutMs: TTS_DOWNLOAD_TIMEOUT_MS });
  if (!audioRes.ok) {
    throw new Error(`EdenAI audio download failed: ${audioRes.status}`);
  }

  const audioBuffer = await audioRes.arrayBuffer();
  return `data:audio/mpeg;base64,${Buffer.from(audioBuffer).toString('base64')}`;
}

const PIPER_MODEL_DIR = resolve(process.cwd(), 'tokens', 'tts', 'piper');
const PIPER_MODEL_URLS: Record<string, { model: string; config: string }> = {
  'en_US-lessac-high': {
    model: 'https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/high/en_US-lessac-high.onnx',
    config: 'https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/high/en_US-lessac-high.onnx.json',
  },
  'en_US-hfc_male-medium': {
    model: 'https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/hfc_male/medium/en_US-hfc_male-medium.onnx',
    config: 'https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/hfc_male/medium/en_US-hfc_male-medium.onnx.json',
  },
};

const piperModelPromises = new Map<string, Promise<string>>();

async function downloadToFile(url: string, filePath: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download ${basename(filePath)}: ${response.status}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, buffer);
}

async function ensurePiperVoiceFiles(voice: string): Promise<string> {
  const voiceOption = getTtsVoiceOption(normalizePiperVoice(voice), 'piper');
  const canonicalVoice = voiceOption.piperVoice || 'en_US-lessac-high';
  const cached = piperModelPromises.get(canonicalVoice);
  if (cached) return cached;

  const promise = (async () => {
    const urls = PIPER_MODEL_URLS[canonicalVoice];
    if (!urls) {
      throw new Error(`Unsupported Piper voice: ${canonicalVoice}`);
    }

    await mkdir(PIPER_MODEL_DIR, { recursive: true });
    const modelPath = join(PIPER_MODEL_DIR, `${canonicalVoice}.onnx`);
    const configPath = join(PIPER_MODEL_DIR, `${canonicalVoice}.onnx.json`);

    try {
      await stat(modelPath);
      await stat(configPath);
    } catch {
      console.log('[TTS] Downloading Piper voice:', canonicalVoice);
      await Promise.all([
        downloadToFile(urls.model, modelPath),
        downloadToFile(urls.config, configPath),
      ]);
    }

    return modelPath;
  })();

  const trackedPromise = promise.catch((error) => {
    piperModelPromises.delete(canonicalVoice);
    throw error;
  });

  piperModelPromises.set(canonicalVoice, trackedPromise);
  return trackedPromise;
}

function resolvePythonCommand(): { command: string; args: string[] }[] {
  return process.platform === 'win32'
    ? [
        { command: 'python', args: [] },
        { command: 'python3', args: [] },
        { command: 'py', args: ['-3'] },
      ]
    : [
        { command: 'python3', args: [] },
        { command: 'python', args: [] },
      ];
}

async function generatePiperTTS(text: string, voice: string): Promise<string> {
  const voiceOption = getTtsVoiceOption(voice, 'piper');
  const modelPath = await ensurePiperVoiceFiles(voiceOption.piperVoice || voiceOption.id);
  const outputPath = join(PIPER_MODEL_DIR, `out-${Date.now()}-${Math.random().toString(36).slice(2)}.wav`);
  const pythonCandidates = resolvePythonCommand();
  let lastError: unknown;

  for (const candidate of pythonCandidates) {
    try {
      await execFileAsync(
        candidate.command,
        [...candidate.args, '-m', 'piper', '-m', modelPath, '-f', outputPath, '--', text],
        { maxBuffer: 10 * 1024 * 1024 },
      );
      const audioBuffer = await readFile(outputPath);
      return `data:audio/wav;base64,${audioBuffer.toString('base64')}`;
    } catch (error) {
      lastError = error;
    } finally {
      await rm(outputPath, { force: true }).catch(() => {});
    }
  }

  throw new Error(`Piper TTS failed: ${(lastError as Error)?.message || 'Unknown error'}`);
}

async function sendToDiscordBridge(audioDataUri: string, text: string, voice: string): Promise<void> {
  try {
    const response = await fetch('http://localhost:8090/discord-tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'discord-tts',
        payload: { audioDataUri, text, voice }
      })
    });
    
    if (!response.ok) {
      throw new Error(`Discord bridge failed: ${response.status}`);
    }
  } catch (error) {
    console.error('Discord bridge error:', error);
    throw error;
  }
}
