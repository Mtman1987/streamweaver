export type TTSProvider = 'edenai';
export type EdenAITTSProvider = 'google' | 'microsoft' | 'amazon' | 'openai';
export type TTSVoiceGender = 'MALE' | 'FEMALE';

export type TTSVoiceOption = {
  id: string;
  label: string;
  provider: TTSProvider;
  providerLabel: string;
  gender: 'Male' | 'Female';
  description: string;
  edenaiProvider: EdenAITTSProvider;
  edenaiOption: TTSVoiceGender;
  edenaiVoiceModel: string;
};

// Curated, named voices only. Every entry here was smoke-tested against the
// production Eden AI account on 2026-07-23. Do not add generic gender-only
// entries: those allow providers to silently choose lower-quality voices.
export const EDENAI_VOICE_OPTIONS: TTSVoiceOption[] = [
  {
    id: 'edenai:openai:nova',
    label: 'Nova',
    provider: 'edenai',
    providerLabel: 'OpenAI via Eden AI',
    gender: 'Female',
    description: 'Bright, natural, and inexpensive',
    edenaiProvider: 'openai',
    edenaiOption: 'FEMALE',
    edenaiVoiceModel: 'nova',
  },
  {
    id: 'edenai:openai:shimmer',
    label: 'Shimmer',
    provider: 'edenai',
    providerLabel: 'OpenAI via Eden AI',
    gender: 'Female',
    description: 'Clear and expressive',
    edenaiProvider: 'openai',
    edenaiOption: 'FEMALE',
    edenaiVoiceModel: 'shimmer',
  },
  {
    id: 'edenai:openai:echo',
    label: 'Echo',
    provider: 'edenai',
    providerLabel: 'OpenAI via Eden AI',
    gender: 'Male',
    description: 'Warm and rounded',
    edenaiProvider: 'openai',
    edenaiOption: 'MALE',
    edenaiVoiceModel: 'echo',
  },
  {
    id: 'edenai:openai:fable',
    label: 'Fable',
    provider: 'edenai',
    providerLabel: 'OpenAI via Eden AI',
    gender: 'Male',
    description: 'Expressive and animated',
    edenaiProvider: 'openai',
    edenaiOption: 'MALE',
    edenaiVoiceModel: 'fable',
  },
  {
    id: 'edenai:openai:onyx',
    label: 'Onyx',
    provider: 'edenai',
    providerLabel: 'OpenAI via Eden AI',
    gender: 'Male',
    description: 'Deep and authoritative',
    edenaiProvider: 'openai',
    edenaiOption: 'MALE',
    edenaiVoiceModel: 'onyx',
  },
  {
    id: 'edenai:google:en-US-Wavenet-F',
    label: 'WaveNet F',
    provider: 'edenai',
    providerLabel: 'Google via Eden AI',
    gender: 'Female',
    description: 'Natural Google WaveNet voice',
    edenaiProvider: 'google',
    edenaiOption: 'FEMALE',
    edenaiVoiceModel: 'en-US-Wavenet-F',
  },
  {
    id: 'edenai:google:en-US-Wavenet-D',
    label: 'WaveNet D',
    provider: 'edenai',
    providerLabel: 'Google via Eden AI',
    gender: 'Male',
    description: 'Natural Google WaveNet voice',
    edenaiProvider: 'google',
    edenaiOption: 'MALE',
    edenaiVoiceModel: 'en-US-Wavenet-D',
  },
  {
    id: 'edenai:microsoft:en-US-JennyNeural',
    label: 'Jenny Neural',
    provider: 'edenai',
    providerLabel: 'Microsoft via Eden AI',
    gender: 'Female',
    description: 'Conversational Microsoft neural voice',
    edenaiProvider: 'microsoft',
    edenaiOption: 'FEMALE',
    edenaiVoiceModel: 'en-US-JennyNeural',
  },
  {
    id: 'edenai:microsoft:en-US-GuyNeural',
    label: 'Guy Neural',
    provider: 'edenai',
    providerLabel: 'Microsoft via Eden AI',
    gender: 'Male',
    description: 'Conversational Microsoft neural voice',
    edenaiProvider: 'microsoft',
    edenaiOption: 'MALE',
    edenaiVoiceModel: 'en-US-GuyNeural',
  },
  {
    id: 'edenai:amazon:Ruth',
    label: 'Ruth',
    provider: 'edenai',
    providerLabel: 'Amazon via Eden AI',
    gender: 'Female',
    description: 'Natural Amazon generative/neural voice',
    edenaiProvider: 'amazon',
    edenaiOption: 'FEMALE',
    edenaiVoiceModel: 'Ruth',
  },
  {
    id: 'edenai:amazon:Joanna',
    label: 'Joanna',
    provider: 'edenai',
    providerLabel: 'Amazon via Eden AI',
    gender: 'Female',
    description: 'Polished Amazon neural voice',
    edenaiProvider: 'amazon',
    edenaiOption: 'FEMALE',
    edenaiVoiceModel: 'Joanna',
  },
  {
    id: 'edenai:amazon:Matthew',
    label: 'Matthew',
    provider: 'edenai',
    providerLabel: 'Amazon via Eden AI',
    gender: 'Male',
    description: 'Natural Amazon generative/neural voice',
    edenaiProvider: 'amazon',
    edenaiOption: 'MALE',
    edenaiVoiceModel: 'Matthew',
  },
];

export const TTS_VOICE_OPTIONS = EDENAI_VOICE_OPTIONS;
export const DEFAULT_TTS_PROVIDER: TTSProvider = 'edenai';
export const DEFAULT_TTS_VOICE = 'edenai:openai:nova';

const LEGACY_VOICE_MAP: Record<string, string> = {
  'openai:nova': 'edenai:openai:nova',
  'openai:shimmer': 'edenai:openai:shimmer',
  'openai:alloy': 'edenai:openai:nova',
  'openai:echo': 'edenai:openai:echo',
  'openai:fable': 'edenai:openai:fable',
  'openai:onyx': 'edenai:openai:onyx',
  nova: 'edenai:openai:nova',
  shimmer: 'edenai:openai:shimmer',
  alloy: 'edenai:openai:nova',
  echo: 'edenai:openai:echo',
  fable: 'edenai:openai:fable',
  onyx: 'edenai:openai:onyx',
  'edenai:google:female': 'edenai:google:en-US-Wavenet-F',
  'edenai:google:male': 'edenai:google:en-US-Wavenet-D',
  'edenai:microsoft:female': 'edenai:microsoft:en-US-JennyNeural',
  'edenai:microsoft:male': 'edenai:microsoft:en-US-GuyNeural',
  'edenai:amazon:female': 'edenai:amazon:Ruth',
  'edenai:amazon:male': 'edenai:amazon:Matthew',
};

export function normalizeTtsProvider(_provider: unknown): TTSProvider {
  return DEFAULT_TTS_PROVIDER;
}

export function normalizeTtsVoice(voice: string | undefined | null, _provider: TTSProvider = DEFAULT_TTS_PROVIDER): string {
  if (!voice) return DEFAULT_TTS_VOICE;
  const trimmed = voice.trim();
  const canonical = TTS_VOICE_OPTIONS.find((option) => option.id.toLowerCase() === trimmed.toLowerCase());
  if (canonical) return canonical.id;

  const legacy = LEGACY_VOICE_MAP[trimmed.toLowerCase()];
  if (legacy) return legacy;

  const lower = trimmed.toLowerCase();
  if (lower.includes('female')) return DEFAULT_TTS_VOICE;
  if (lower.includes('male') || ['charon', 'fenrir', 'puck', 'orus', 'algieba'].includes(lower)) {
    return 'edenai:openai:onyx';
  }
  return DEFAULT_TTS_VOICE;
}

export function getTtsVoiceOption(voice: string | undefined | null, provider: TTSProvider = DEFAULT_TTS_PROVIDER): TTSVoiceOption {
  const normalized = normalizeTtsVoice(voice, provider);
  return TTS_VOICE_OPTIONS.find((option) => option.id === normalized) || TTS_VOICE_OPTIONS[0];
}

export function getProviderForVoice(_voice: string | undefined | null, _fallback: TTSProvider = DEFAULT_TTS_PROVIDER): TTSProvider {
  return 'edenai';
}

export function getFallbackVoiceForProvider(_provider: TTSProvider, selectedVoice?: string | null): string {
  const selected = getTtsVoiceOption(selectedVoice);
  return selected.gender === 'Male' ? 'edenai:openai:onyx' : DEFAULT_TTS_VOICE;
}

// Backward-compatible exports used by older workflow/config callers.
export function normalizePiperVoice(voice?: string | null): string { return normalizeTtsVoice(voice); }
export function normalizeEdenAIVoice(voice?: string | null): string { return normalizeTtsVoice(voice); }
export function normalizeOpenAIVoice(voice?: string | null): string { return normalizeTtsVoice(voice); }
