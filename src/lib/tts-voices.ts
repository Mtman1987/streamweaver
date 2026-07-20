export type TTSProvider = 'edenai' | 'openai' | 'gemini';
export type EdenAITTSProvider = 'google' | 'microsoft' | 'amazon';
export type OpenAITTSVoice = 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer';
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

export const OPENAI_VOICE_OPTIONS: TTSVoiceOption[] = [
  { id: 'openai:alloy', label: 'Alloy', provider: 'openai', providerLabel: 'OpenAI', gender: 'Female', description: 'Neutral and balanced' },
  { id: 'openai:echo', label: 'Echo', provider: 'openai', providerLabel: 'OpenAI', gender: 'Male', description: 'Warm and rounded' },
  { id: 'openai:fable', label: 'Fable', provider: 'openai', providerLabel: 'OpenAI', gender: 'Male', description: 'Expressive and dynamic' },
  { id: 'openai:onyx', label: 'Onyx', provider: 'openai', providerLabel: 'OpenAI', gender: 'Male', description: 'Deep and authoritative' },
  { id: 'openai:nova', label: 'Nova', provider: 'openai', providerLabel: 'OpenAI', gender: 'Female', description: 'Energetic and bright' },
  { id: 'openai:shimmer', label: 'Shimmer', provider: 'openai', providerLabel: 'OpenAI', gender: 'Female', description: 'Clear and expressive' },
];

export const GEMINI_VOICE_OPTIONS: TTSVoiceOption[] = [
  { id: 'gemini:Aoede',  label: 'Aoede',  provider: 'gemini', providerLabel: 'Gemini', gender: 'Female', description: 'Bright and expressive' },
  { id: 'gemini:Charon', label: 'Charon', provider: 'gemini', providerLabel: 'Gemini', gender: 'Male',   description: 'Deep and informative' },
  { id: 'gemini:Fenrir', label: 'Fenrir', provider: 'gemini', providerLabel: 'Gemini', gender: 'Male',   description: 'Excitable and energetic' },
  { id: 'gemini:Kore',   label: 'Kore',   provider: 'gemini', providerLabel: 'Gemini', gender: 'Female', description: 'Firm and confident' },
  { id: 'gemini:Puck',   label: 'Puck',   provider: 'gemini', providerLabel: 'Gemini', gender: 'Male',   description: 'Upbeat and clear' },
  { id: 'gemini:Leda',   label: 'Leda',   provider: 'gemini', providerLabel: 'Gemini', gender: 'Female', description: 'Warm and natural' },
  { id: 'gemini:Orus',   label: 'Orus',   provider: 'gemini', providerLabel: 'Gemini', gender: 'Male',   description: 'Smooth and steady' },
  { id: 'gemini:Zephyr', label: 'Zephyr', provider: 'gemini', providerLabel: 'Gemini', gender: 'Female', description: 'Bright and airy' },
];

export const GOOGLE_VOICE_OPTIONS: TTSVoiceOption[] = [];

export const TTS_VOICE_OPTIONS: TTSVoiceOption[] = [...EDENAI_VOICE_OPTIONS, ...OPENAI_VOICE_OPTIONS, ...GEMINI_VOICE_OPTIONS];

export const DEFAULT_TTS_PROVIDER: TTSProvider = 'gemini';
export const DEFAULT_TTS_VOICE = 'gemini:Aoede';

export function normalizeTtsProvider(provider: unknown): TTSProvider {
  const p = String(provider || '').trim().toLowerCase();
  if (p === 'openai') return 'openai';
  if (p === 'gemini') return 'gemini';
  if (p === 'edenai') return 'edenai';
  return DEFAULT_TTS_PROVIDER;
}

export function normalizeTtsVoice(voice: string | undefined | null, provider: TTSProvider = DEFAULT_TTS_PROVIDER): string {
  if (!voice) {
    if (provider === 'openai') return 'openai:nova';
    if (provider === 'gemini') return 'gemini:Aoede';
    return DEFAULT_TTS_VOICE;
  }
  const trimmed = voice.trim();
  const canonical = TTS_VOICE_OPTIONS.find((o) => o.id.toLowerCase() === trimmed.toLowerCase());
  if (canonical) return canonical.id;
  // Legacy name mapping
  const lower = trimmed.toLowerCase();
  if (lower === 'alloy' || lower === 'echo' || lower === 'fable' || lower === 'onyx' || lower === 'nova' || lower === 'shimmer') return `openai:${lower}`;
  if (lower.includes('female') || lower.includes('wavenet-f')) return 'edenai:google:FEMALE';
  if (lower.includes('male') || lower.includes('wavenet-m') || lower.includes('wavenet-d')) return 'edenai:google:MALE';
  return DEFAULT_TTS_VOICE;
}

export function getTtsVoiceOption(voice: string | undefined | null, provider: TTSProvider = DEFAULT_TTS_PROVIDER): TTSVoiceOption {
  const normalized = normalizeTtsVoice(voice, provider);
  return TTS_VOICE_OPTIONS.find((o) => o.id === normalized) || EDENAI_VOICE_OPTIONS[0];
}

export function getProviderForVoice(voice: string | undefined | null, fallback: TTSProvider = DEFAULT_TTS_PROVIDER): TTSProvider {
  if (typeof voice === 'string') {
    const v = voice.trim().toLowerCase();
    if (v.startsWith('openai:')) return 'openai';
    if (v.startsWith('gemini:')) return 'gemini';
  }
  return getTtsVoiceOption(voice, fallback).provider;
}

export function getFallbackVoiceForProvider(_provider: TTSProvider, selectedVoice?: string | null): string {
  const selected = getTtsVoiceOption(selectedVoice);
  return selected.gender === 'Male' ? 'edenai:google:MALE' : 'edenai:google:FEMALE';
}

// Keep these exports for backward compat
export function normalizePiperVoice(_voice?: string | null): string { return DEFAULT_TTS_VOICE; }
export function normalizeEdenAIVoice(voice?: string | null): string { return normalizeTtsVoice(voice, 'edenai'); }
export function normalizeOpenAIVoice(voice?: string | null): string { return normalizeTtsVoice(voice, 'openai'); }
