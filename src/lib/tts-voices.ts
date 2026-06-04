export type TTSProvider = 'piper' | 'edenai';
export type EdenAITTSProvider = 'openai' | 'google' | 'microsoft' | 'amazon';
export type TTSVoiceGender = 'MALE' | 'FEMALE';

export type TTSVoiceOption = {
  id: string;
  label: string;
  provider: TTSProvider;
  providerLabel: string;
  gender: 'Male' | 'Female';
  description: string;
  piperVoice?: string;
  edenaiProvider?: EdenAITTSProvider;
  edenaiOption?: TTSVoiceGender;
};

export const PIPER_VOICE_OPTIONS: TTSVoiceOption[] = [
  {
    id: 'piper:en_US-lessac-high',
    label: 'Lessac',
    provider: 'piper',
    providerLabel: 'Piper',
    gender: 'Female',
    description: 'Warm, natural US English voice',
    piperVoice: 'en_US-lessac-high',
  },
  {
    id: 'piper:en_US-hfc_male-medium',
    label: 'HFC Male',
    provider: 'piper',
    providerLabel: 'Piper',
    gender: 'Male',
    description: 'Clear, friendly US English male voice',
    piperVoice: 'en_US-hfc_male-medium',
  },
];

export const EDENAI_VOICE_OPTIONS: TTSVoiceOption[] = [
  {
    id: 'edenai:openai:FEMALE',
    label: 'OpenAI Female',
    provider: 'edenai',
    providerLabel: 'OpenAI',
    gender: 'Female',
    description: 'EdenAI routed OpenAI voice',
    edenaiProvider: 'openai',
    edenaiOption: 'FEMALE',
  },
  {
    id: 'edenai:openai:MALE',
    label: 'OpenAI Male',
    provider: 'edenai',
    providerLabel: 'OpenAI',
    gender: 'Male',
    description: 'EdenAI routed OpenAI voice',
    edenaiProvider: 'openai',
    edenaiOption: 'MALE',
  },
  {
    id: 'edenai:google:FEMALE',
    label: 'Google Female',
    provider: 'edenai',
    providerLabel: 'Google',
    gender: 'Female',
    description: 'EdenAI routed Google voice',
    edenaiProvider: 'google',
    edenaiOption: 'FEMALE',
  },
  {
    id: 'edenai:google:MALE',
    label: 'Google Male',
    provider: 'edenai',
    providerLabel: 'Google',
    gender: 'Male',
    description: 'EdenAI routed Google voice',
    edenaiProvider: 'google',
    edenaiOption: 'MALE',
  },
  {
    id: 'edenai:microsoft:FEMALE',
    label: 'Microsoft Female',
    provider: 'edenai',
    providerLabel: 'Microsoft',
    gender: 'Female',
    description: 'EdenAI routed Microsoft voice',
    edenaiProvider: 'microsoft',
    edenaiOption: 'FEMALE',
  },
  {
    id: 'edenai:microsoft:MALE',
    label: 'Microsoft Male',
    provider: 'edenai',
    providerLabel: 'Microsoft',
    gender: 'Male',
    description: 'EdenAI routed Microsoft voice',
    edenaiProvider: 'microsoft',
    edenaiOption: 'MALE',
  },
  {
    id: 'edenai:amazon:FEMALE',
    label: 'Amazon Female',
    provider: 'edenai',
    providerLabel: 'Amazon',
    gender: 'Female',
    description: 'EdenAI routed Amazon voice',
    edenaiProvider: 'amazon',
    edenaiOption: 'FEMALE',
  },
  {
    id: 'edenai:amazon:MALE',
    label: 'Amazon Male',
    provider: 'edenai',
    providerLabel: 'Amazon',
    gender: 'Male',
    description: 'EdenAI routed Amazon voice',
    edenaiProvider: 'amazon',
    edenaiOption: 'MALE',
  },
];

export const TTS_VOICE_OPTIONS = [...PIPER_VOICE_OPTIONS, ...EDENAI_VOICE_OPTIONS];

export const DEFAULT_TTS_PROVIDER: TTSProvider = 'piper';
export const DEFAULT_TTS_VOICE = PIPER_VOICE_OPTIONS[0].id;
export const DEFAULT_EDENAI_VOICE = EDENAI_VOICE_OPTIONS[0].id;

const FEMALE_LEGACY_VOICES = new Set([
  'ashley',
  'sarah',
  'rachel',
  'bella',
  'lauren',
  'jessica',
  'kelsey',
  'kayla',
  'chloe',
  'serena',
  'celeste',
  'evelyn',
  'luna',
  'pippa',
  'tessa',
  'naomi',
  'nadia',
  'selene',
  'riley',
  'mia',
  'hana',
  'bianca',
  'olivia',
  'wendy',
  'elizabeth',
  'claire',
  'loretta',
  'darlene',
  'abby',
  'julia',
  'pixie',
  'amina',
  'sophie',
  'eleanor',
  'nova',
  'shimmer',
  'en-us-wavenet-f',
  'en-gb-wavenet-f',
  'algieba',
]);

const MALE_LEGACY_VOICES = new Set([
  'marcus',
  'david',
  'mortimer',
  'snik',
  'hades',
  'dominus',
  'victor',
  'lucian',
  'sebastian',
  'malcolm',
  'vinny',
  'conrad',
  'damon',
  'levi',
  'theodore',
  'ronald',
  'rupert',
  'graham',
  'hank',
  'oliver',
  'simon',
  'elliot',
  'james',
  'gareth',
  'nate',
  'brian',
  'ethan',
  'tyler',
  'jason',
  'jake',
  'liam',
  'callum',
  'hamish',
  'arjun',
  'craig',
  'dennis',
  'edward',
  'mark',
  'shaun',
  'timothy',
  'clive',
  'carter',
  'blake',
  'cedric',
  'jonah',
  'avery',
  'brandon',
  'trevor',
  'alex',
  'derek',
  'evan',
  'grant',
  'tristan',
  'reed',
  'duncan',
  'felix',
  'antoni',
  'josh',
  'arnold',
  'adam',
  'sam',
  'alloy',
  'echo',
  'fable',
  'onyx',
  'en-us-wavenet-m',
  'en-gb-wavenet-m',
]);

export function normalizeTtsProvider(provider: unknown): TTSProvider {
  if (typeof provider !== 'string') return DEFAULT_TTS_PROVIDER;
  const normalized = provider.trim().toLowerCase();
  if (['edenai', 'openai', 'google', 'microsoft', 'amazon'].includes(normalized)) {
    return 'edenai';
  }
  return DEFAULT_TTS_PROVIDER;
}

export function normalizePiperVoice(voice: string | undefined | null): string {
  if (!voice) return DEFAULT_TTS_VOICE;

  const trimmed = voice.trim();
  const canonical = PIPER_VOICE_OPTIONS.find((option) => (
    option.id.toLowerCase() === trimmed.toLowerCase()
    || option.piperVoice?.toLowerCase() === trimmed.toLowerCase()
  ));
  if (canonical) return canonical.id;

  const lower = trimmed.toLowerCase();
  if (FEMALE_LEGACY_VOICES.has(lower)) return PIPER_VOICE_OPTIONS[0].id;
  if (MALE_LEGACY_VOICES.has(lower)) return PIPER_VOICE_OPTIONS[1].id;

  return DEFAULT_TTS_VOICE;
}

export function normalizeEdenAIVoice(voice: string | undefined | null): string {
  if (!voice) return DEFAULT_EDENAI_VOICE;
  const lower = voice.trim().toLowerCase();
  if (lower === 'en-us-wavenet-f' || lower === 'en-gb-wavenet-f') return 'edenai:google:FEMALE';
  if (lower === 'en-us-wavenet-m' || lower === 'en-gb-wavenet-m') return 'edenai:google:MALE';
  if (lower === 'nova' || lower === 'shimmer') return 'edenai:openai:FEMALE';
  return 'edenai:openai:MALE';
}

export function normalizeTtsVoice(voice: string | undefined | null, provider: TTSProvider = DEFAULT_TTS_PROVIDER): string {
  if (!voice) return provider === 'edenai' ? DEFAULT_EDENAI_VOICE : DEFAULT_TTS_VOICE;

  const trimmed = voice.trim();
  const canonical = TTS_VOICE_OPTIONS.find((option) => option.id.toLowerCase() === trimmed.toLowerCase());
  if (canonical) return canonical.id;

  if (provider === 'edenai') return normalizeEdenAIVoice(trimmed);
  return normalizePiperVoice(trimmed);
}

export function getTtsVoiceOption(voice: string | undefined | null, provider: TTSProvider = DEFAULT_TTS_PROVIDER): TTSVoiceOption {
  const normalized = normalizeTtsVoice(voice, provider);
  return TTS_VOICE_OPTIONS.find((option) => option.id === normalized) || PIPER_VOICE_OPTIONS[0];
}

export function getProviderForVoice(voice: string | undefined | null, fallback: TTSProvider = DEFAULT_TTS_PROVIDER): TTSProvider {
  return getTtsVoiceOption(voice, fallback).provider;
}

export function getFallbackVoiceForProvider(provider: TTSProvider, selectedVoice?: string | null): string {
  const selected = getTtsVoiceOption(selectedVoice, provider);
  if (provider === 'edenai') {
    return selected.gender === 'Male' ? PIPER_VOICE_OPTIONS[1].id : PIPER_VOICE_OPTIONS[0].id;
  }

  return selected.gender === 'Male' ? 'edenai:openai:MALE' : DEFAULT_EDENAI_VOICE;
}
