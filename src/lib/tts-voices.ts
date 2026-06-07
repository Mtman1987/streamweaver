export type TTSProvider = 'piper' | 'edenai' | 'openai';
export type EdenAITTSProvider = 'openai' | 'google' | 'microsoft' | 'amazon';
export type TTSVoiceGender = 'MALE' | 'FEMALE';
export type OpenAITTSVoice =
  | 'alloy'
  | 'ash'
  | 'ballad'
  | 'coral'
  | 'echo'
  | 'fable'
  | 'onyx'
  | 'nova'
  | 'sage'
  | 'shimmer'
  | 'verse'
  | 'marin'
  | 'cedar';

export type TTSVoiceOption = {
  id: string;
  label: string;
  provider: TTSProvider;
  providerLabel: string;
  gender: 'Male' | 'Female' | 'Neutral';
  description: string;
  piperVoice?: string;
  edenaiProvider?: EdenAITTSProvider;
  edenaiOption?: TTSVoiceGender;
  openaiVoice?: OpenAITTSVoice;
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

export const OPENAI_VOICE_OPTIONS: TTSVoiceOption[] = [
  {
    id: 'openai:nova',
    label: 'Nova',
    provider: 'openai',
    providerLabel: 'OpenAI',
    gender: 'Female',
    description: 'Smooth, bright direct OpenAI voice',
    openaiVoice: 'nova',
  },
  {
    id: 'openai:shimmer',
    label: 'Shimmer',
    provider: 'openai',
    providerLabel: 'OpenAI',
    gender: 'Female',
    description: 'Warm, polished direct OpenAI voice',
    openaiVoice: 'shimmer',
  },
  {
    id: 'openai:coral',
    label: 'Coral',
    provider: 'openai',
    providerLabel: 'OpenAI',
    gender: 'Female',
    description: 'Expressive direct OpenAI voice',
    openaiVoice: 'coral',
  },
  {
    id: 'openai:marin',
    label: 'Marin',
    provider: 'openai',
    providerLabel: 'OpenAI',
    gender: 'Female',
    description: 'Clear direct OpenAI voice',
    openaiVoice: 'marin',
  },
  {
    id: 'openai:sage',
    label: 'Sage',
    provider: 'openai',
    providerLabel: 'OpenAI',
    gender: 'Female',
    description: 'Calm direct OpenAI voice',
    openaiVoice: 'sage',
  },
  {
    id: 'openai:onyx',
    label: 'Onyx',
    provider: 'openai',
    providerLabel: 'OpenAI',
    gender: 'Male',
    description: 'Deep direct OpenAI voice',
    openaiVoice: 'onyx',
  },
  {
    id: 'openai:echo',
    label: 'Echo',
    provider: 'openai',
    providerLabel: 'OpenAI',
    gender: 'Male',
    description: 'Crisp direct OpenAI voice',
    openaiVoice: 'echo',
  },
  {
    id: 'openai:ash',
    label: 'Ash',
    provider: 'openai',
    providerLabel: 'OpenAI',
    gender: 'Male',
    description: 'Natural direct OpenAI voice',
    openaiVoice: 'ash',
  },
  {
    id: 'openai:ballad',
    label: 'Ballad',
    provider: 'openai',
    providerLabel: 'OpenAI',
    gender: 'Male',
    description: 'Narrative direct OpenAI voice',
    openaiVoice: 'ballad',
  },
  {
    id: 'openai:cedar',
    label: 'Cedar',
    provider: 'openai',
    providerLabel: 'OpenAI',
    gender: 'Male',
    description: 'Grounded direct OpenAI voice',
    openaiVoice: 'cedar',
  },
  {
    id: 'openai:fable',
    label: 'Fable',
    provider: 'openai',
    providerLabel: 'OpenAI',
    gender: 'Male',
    description: 'Characterful direct OpenAI voice',
    openaiVoice: 'fable',
  },
  {
    id: 'openai:verse',
    label: 'Verse',
    provider: 'openai',
    providerLabel: 'OpenAI',
    gender: 'Male',
    description: 'Energetic direct OpenAI voice',
    openaiVoice: 'verse',
  },
  {
    id: 'openai:alloy',
    label: 'Alloy',
    provider: 'openai',
    providerLabel: 'OpenAI',
    gender: 'Neutral',
    description: 'Balanced direct OpenAI voice',
    openaiVoice: 'alloy',
  },
];

export const TTS_VOICE_OPTIONS = [...OPENAI_VOICE_OPTIONS, ...EDENAI_VOICE_OPTIONS, ...PIPER_VOICE_OPTIONS];

export const DEFAULT_TTS_PROVIDER: TTSProvider = 'piper';
export const DEFAULT_TTS_VOICE = PIPER_VOICE_OPTIONS[0].id;
export const DEFAULT_EDENAI_VOICE = EDENAI_VOICE_OPTIONS[0].id;
export const DEFAULT_OPENAI_VOICE = OPENAI_VOICE_OPTIONS[0].id;

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
  if (['edenai', 'google', 'microsoft', 'amazon'].includes(normalized)) {
    return 'edenai';
  }
  if (['openai', 'direct-openai', 'direct_openai', 'inworld'].includes(normalized)) return 'openai';
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

export function normalizeOpenAIVoice(voice: string | undefined | null): string {
  if (!voice) return DEFAULT_OPENAI_VOICE;

  const trimmed = voice.trim();
  const canonical = OPENAI_VOICE_OPTIONS.find((option) => (
    option.id.toLowerCase() === trimmed.toLowerCase()
    || option.openaiVoice?.toLowerCase() === trimmed.toLowerCase()
  ));
  if (canonical) return canonical.id;

  const lower = trimmed.toLowerCase();
  if (FEMALE_LEGACY_VOICES.has(lower)) return DEFAULT_OPENAI_VOICE;
  if (MALE_LEGACY_VOICES.has(lower)) return 'openai:onyx';

  return DEFAULT_OPENAI_VOICE;
}

export function normalizeTtsVoice(voice: string | undefined | null, provider: TTSProvider = DEFAULT_TTS_PROVIDER): string {
  if (!voice) {
    if (provider === 'edenai') return DEFAULT_EDENAI_VOICE;
    if (provider === 'openai') return DEFAULT_OPENAI_VOICE;
    return DEFAULT_TTS_VOICE;
  }

  const trimmed = voice.trim();
  const canonical = TTS_VOICE_OPTIONS.find((option) => option.id.toLowerCase() === trimmed.toLowerCase());
  if (canonical) return canonical.id;

  if (provider === 'edenai') return normalizeEdenAIVoice(trimmed);
  if (provider === 'openai') return normalizeOpenAIVoice(trimmed);
  return normalizePiperVoice(trimmed);
}

export function getTtsVoiceOption(voice: string | undefined | null, provider: TTSProvider = DEFAULT_TTS_PROVIDER): TTSVoiceOption {
  const normalized = normalizeTtsVoice(voice, provider);
  const fallback =
    provider === 'edenai' ? EDENAI_VOICE_OPTIONS[0]
    : provider === 'openai' ? OPENAI_VOICE_OPTIONS[0]
    : PIPER_VOICE_OPTIONS[0];
  return TTS_VOICE_OPTIONS.find((option) => option.id === normalized) || fallback;
}

export function getProviderForVoice(voice: string | undefined | null, fallback: TTSProvider = DEFAULT_TTS_PROVIDER): TTSProvider {
  return getTtsVoiceOption(voice, fallback).provider;
}

export function getFallbackVoiceForProvider(provider: TTSProvider, selectedVoice?: string | null): string {
  const selected = getTtsVoiceOption(selectedVoice, provider);
  if (provider === 'edenai') {
    return selected.gender === 'Male' ? PIPER_VOICE_OPTIONS[1].id : PIPER_VOICE_OPTIONS[0].id;
  }
  if (provider === 'openai') {
    return selected.gender === 'Male' ? 'edenai:openai:MALE' : DEFAULT_EDENAI_VOICE;
  }

  return selected.gender === 'Male' ? 'edenai:openai:MALE' : DEFAULT_EDENAI_VOICE;
}
