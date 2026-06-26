export type TTSProvider = 'edenai' | 'google';
export type EdenAITTSProvider = 'google' | 'microsoft' | 'amazon';
export type TTSVoiceGender = 'MALE' | 'FEMALE';

export type TTSVoiceOption = {
  id: string;
  label: string;
  provider: TTSProvider;
  providerLabel: string;
  gender: 'Male' | 'Female';
  description: string;
  edenaiProvider?: EdenAITTSProvider;
  edenaiOption?: TTSVoiceGender;
  googleVoice?: string;
};

export const EDENAI_VOICE_OPTIONS: TTSVoiceOption[] = [
  {
    id: 'edenai:google:FEMALE',
    label: 'Google Female',
    provider: 'edenai',
    providerLabel: 'Google',
    gender: 'Female',
    description: 'Natural Google WaveNet female voice',
    edenaiProvider: 'google',
    edenaiOption: 'FEMALE',
  },
  {
    id: 'edenai:google:MALE',
    label: 'Google Male',
    provider: 'edenai',
    providerLabel: 'Google',
    gender: 'Male',
    description: 'Natural Google WaveNet male voice',
    edenaiProvider: 'google',
    edenaiOption: 'MALE',
  },
  {
    id: 'edenai:microsoft:FEMALE',
    label: 'Microsoft Female',
    provider: 'edenai',
    providerLabel: 'Microsoft',
    gender: 'Female',
    description: 'Natural Microsoft Azure female voice',
    edenaiProvider: 'microsoft',
    edenaiOption: 'FEMALE',
  },
  {
    id: 'edenai:microsoft:MALE',
    label: 'Microsoft Male',
    provider: 'edenai',
    providerLabel: 'Microsoft',
    gender: 'Male',
    description: 'Natural Microsoft Azure male voice',
    edenaiProvider: 'microsoft',
    edenaiOption: 'MALE',
  },
  {
    id: 'edenai:amazon:FEMALE',
    label: 'Amazon Female',
    provider: 'edenai',
    providerLabel: 'Amazon',
    gender: 'Female',
    description: 'Natural Amazon Polly female voice',
    edenaiProvider: 'amazon',
    edenaiOption: 'FEMALE',
  },
  {
    id: 'edenai:amazon:MALE',
    label: 'Amazon Male',
    provider: 'edenai',
    providerLabel: 'Amazon',
    gender: 'Male',
    description: 'Natural Amazon Polly male voice',
    edenaiProvider: 'amazon',
    edenaiOption: 'MALE',
  },
];

export const GOOGLE_VOICE_OPTIONS: TTSVoiceOption[] = [
  {
    id: 'google:en-US-Wavenet-F',
    label: 'Google WaveNet Female',
    provider: 'google',
    providerLabel: 'Google Cloud',
    gender: 'Female',
    description: 'Direct Google Cloud WaveNet female (fallback)',
    googleVoice: 'en-US-Wavenet-F',
  },
  {
    id: 'google:en-US-Wavenet-D',
    label: 'Google WaveNet Male',
    provider: 'google',
    providerLabel: 'Google Cloud',
    gender: 'Male',
    description: 'Direct Google Cloud WaveNet male (fallback)',
    googleVoice: 'en-US-Wavenet-D',
  },
];

export const TTS_VOICE_OPTIONS: TTSVoiceOption[] = [...EDENAI_VOICE_OPTIONS, ...GOOGLE_VOICE_OPTIONS];

export const DEFAULT_TTS_PROVIDER: TTSProvider = 'edenai';
export const DEFAULT_TTS_VOICE = 'edenai:google:FEMALE';

export function normalizeTtsProvider(provider: unknown): TTSProvider {
  if (typeof provider !== 'string') return DEFAULT_TTS_PROVIDER;
  const normalized = provider.trim().toLowerCase();
  if (normalized === 'google') return 'google';
  return 'edenai';
}

export function normalizeTtsVoice(voice: string | undefined | null, provider: TTSProvider = DEFAULT_TTS_PROVIDER): string {
  if (!voice) return DEFAULT_TTS_VOICE;
  const trimmed = voice.trim();
  const canonical = TTS_VOICE_OPTIONS.find((o) => o.id.toLowerCase() === trimmed.toLowerCase());
  if (canonical) return canonical.id;
  // Legacy name mapping
  const lower = trimmed.toLowerCase();
  if (lower.includes('female') || lower.includes('wavenet-f')) return provider === 'google' ? 'google:en-US-Wavenet-F' : 'edenai:google:FEMALE';
  if (lower.includes('male') || lower.includes('wavenet-m') || lower.includes('wavenet-d')) return provider === 'google' ? 'google:en-US-Wavenet-D' : 'edenai:google:MALE';
  return DEFAULT_TTS_VOICE;
}

export function getTtsVoiceOption(voice: string | undefined | null, provider: TTSProvider = DEFAULT_TTS_PROVIDER): TTSVoiceOption {
  const normalized = normalizeTtsVoice(voice, provider);
  return TTS_VOICE_OPTIONS.find((o) => o.id === normalized) || EDENAI_VOICE_OPTIONS[0];
}

export function getProviderForVoice(voice: string | undefined | null, fallback: TTSProvider = DEFAULT_TTS_PROVIDER): TTSProvider {
  return getTtsVoiceOption(voice, fallback).provider;
}

export function getFallbackVoiceForProvider(_provider: TTSProvider, selectedVoice?: string | null): string {
  const selected = getTtsVoiceOption(selectedVoice);
  return selected.gender === 'Male' ? 'google:en-US-Wavenet-D' : 'google:en-US-Wavenet-F';
}

// Keep these exports for backward compat but they all resolve to edenai now
export function normalizePiperVoice(_voice?: string | null): string { return DEFAULT_TTS_VOICE; }
export function normalizeEdenAIVoice(voice?: string | null): string { return normalizeTtsVoice(voice, 'edenai'); }
export function normalizeOpenAIVoice(_voice?: string | null): string { return DEFAULT_TTS_VOICE; }
