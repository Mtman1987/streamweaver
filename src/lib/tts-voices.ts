export type TTSProvider = 'edenai' | 'deepgram' | 'kokoro' | 'gemini';
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
  deepgramModel?: string;
  livekitDescriptor?: string;
  /** Prebuilt voice name on Gemini TTS; only used with an operator-verified free-tier key. */
  geminiVoice?: string;
  /** Natural-language delivery direction sent as structured speech metadata. */
  speechStyle?: string;
};

export const ATHENA_TENANT_ID = '94371378';
export const ATHENA_CANONICAL_TTS_VOICE = 'deepgram:aura-2:athena';
export const ATHENA_DEEPGRAM_TTS_MODEL = 'aura-2-athena-en';
export const ATHENA_LIVEKIT_TTS_DESCRIPTOR = 'deepgram/aura-2:athena';

export const DEEPGRAM_VOICE_OPTIONS: TTSVoiceOption[] = [
  {
    id: ATHENA_CANONICAL_TTS_VOICE,
    label: 'Athena',
    provider: 'deepgram',
    providerLabel: 'Deepgram Aura-2',
    gender: 'Female',
    description: 'Athena canonical voice across direct Deepgram and LiveKit Inference',
    edenaiProvider: 'openai',
    edenaiOption: 'FEMALE',
    edenaiVoiceModel: ATHENA_DEEPGRAM_TTS_MODEL,
    deepgramModel: ATHENA_DEEPGRAM_TTS_MODEL,
    livekitDescriptor: ATHENA_LIVEKIT_TTS_DESCRIPTOR,
  },
  {
    id: 'deepgram:aura-2:apollo',
    label: 'Apollo',
    provider: 'deepgram',
    providerLabel: 'Deepgram Aura-2',
    gender: 'Male',
    description: 'Comfortable, casual US English voice available through LiveKit',
    edenaiProvider: 'openai',
    edenaiOption: 'MALE',
    edenaiVoiceModel: 'aura-2-apollo-en',
    deepgramModel: 'aura-2-apollo-en',
    livekitDescriptor: 'deepgram/aura-2:apollo',
  },
  {
    id: 'deepgram:aura-2:odysseus',
    label: 'Odysseus',
    provider: 'deepgram',
    providerLabel: 'Deepgram Aura-2',
    gender: 'Male',
    description: 'Calm, professional US English voice available through LiveKit',
    edenaiProvider: 'openai',
    edenaiOption: 'MALE',
    edenaiVoiceModel: 'aura-2-odysseus-en',
    deepgramModel: 'aura-2-odysseus-en',
    livekitDescriptor: 'deepgram/aura-2:odysseus',
  },
  {
    id: 'deepgram:aura-2:theia',
    label: 'Theia',
    provider: 'deepgram',
    providerLabel: 'Deepgram Aura-2',
    gender: 'Female',
    description: 'Expressive Australian English voice available through LiveKit',
    edenaiProvider: 'openai',
    edenaiOption: 'FEMALE',
    edenaiVoiceModel: 'aura-2-theia-en',
    deepgramModel: 'aura-2-theia-en',
    livekitDescriptor: 'deepgram/aura-2:theia',
  },
];

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

export const KOKORO_VOICE_OPTIONS: TTSVoiceOption[] = [
  ['af_heart', 'Heart', 'Female'], ['af_bella', 'Bella', 'Female'],
  ['af_nicole', 'Nicole', 'Female'], ['af_kore', 'Kore', 'Female'],
  ['af_sarah', 'Sarah', 'Female'], ['af_aoede', 'Aoede', 'Female'],
  ['af_alloy', 'Alloy', 'Female'], ['af_jessica', 'Jessica', 'Female'],
  ['af_nova', 'Nova (Kokoro)', 'Female'], ['af_river', 'River', 'Female'],
  ['af_sky', 'Sky', 'Female'],
  ['am_michael', 'Michael', 'Male'], ['am_puck', 'Puck', 'Male'],
  ['am_fenrir', 'Fenrir', 'Male'], ['am_adam', 'Adam', 'Male'],
  ['am_echo', 'Echo (Kokoro)', 'Male'], ['am_eric', 'Eric', 'Male'],
  ['am_liam', 'Liam', 'Male'], ['am_onyx', 'Onyx (Kokoro)', 'Male'],
  ['am_santa', 'Santa', 'Male'],
  ['bm_george', 'George (UK)', 'Male'], ['bf_emma', 'Emma (UK)', 'Female'],
  ['bf_alice', 'Alice (UK)', 'Female'], ['bf_isabella', 'Isabella (UK)', 'Female'],
  ['bf_lily', 'Lily (UK)', 'Female'], ['bm_daniel', 'Daniel (UK)', 'Male'],
  ['bm_fable', 'Fable (UK)', 'Male'], ['bm_lewis', 'Lewis (UK)', 'Male'],
].map(([name, label, gender]) => ({
  id: `kokoro:${name}`, label, gender: gender as 'Male' | 'Female', provider: 'kokoro',
  providerLabel: 'Kokoro free voice trial', description: 'Local neural voice; no per-character provider charge',
  edenaiProvider: 'openai', edenaiOption: gender === 'Male' ? 'MALE' : 'FEMALE', edenaiVoiceModel: name,
}));
export const SCOTTISH_GEMINI_VOICE_ID = 'gemini:charon:scottish';

export const GEMINI_VOICE_OPTIONS: TTSVoiceOption[] = [
  {
    id: 'gemini:kore:natural', label: 'Kore — Warm & Natural', provider: 'gemini',
    providerLabel: 'Gemini free-tier TTS (opt-in)', gender: 'Female',
    description: 'Warm, expressive conversational delivery; requires a verified-free Gemini API key.',
    edenaiProvider: 'openai', edenaiOption: 'FEMALE', edenaiVoiceModel: 'Kore',
    geminiVoice: 'Kore',
    speechStyle: 'A warm, natural adult female conversational voice. Use human-like prosody, gently varied pitch and pace, clear articulation and natural pauses. Friendly and present, never flat, stiff, or robotic. Read the transcript exactly without adding words.',
  },
  {
    id: 'gemini:aoede:breezy', label: 'Aoede — Breezy & Friendly', provider: 'gemini',
    providerLabel: 'Gemini free-tier TTS (opt-in)', gender: 'Female',
    description: 'Light, personable voice with lively but restrained cadence.',
    edenaiProvider: 'openai', edenaiOption: 'FEMALE', edenaiVoiceModel: 'Aoede',
    geminiVoice: 'Aoede',
    speechStyle: 'A breezy, friendly adult female voice speaking naturally to a friend. Use varied intonation, subtle warmth, relaxed phrasing, clear pronunciation and natural pauses. Avoid sing-song exaggeration and monotone delivery. Read the transcript exactly without adding words.',
  },
  {
    id: 'gemini:puck:upbeat', label: 'Puck — Lively & Conversational', provider: 'gemini',
    providerLabel: 'Gemini free-tier TTS (opt-in)', gender: 'Male',
    description: 'Lively male voice with natural emphasis and conversational pacing.',
    edenaiProvider: 'openai', edenaiOption: 'MALE', edenaiVoiceModel: 'Puck',
    geminiVoice: 'Puck',
    speechStyle: 'A lively, warm adult male conversational voice. Emphasize meaningful words naturally, use varied pitch and pace with brief human pauses, and sound engaged rather than announcer-like. Never monotone or robotic. Read the transcript exactly without adding words.',
  },
  {
    id: SCOTTISH_GEMINI_VOICE_ID, label: 'Charon — Scottish', provider: 'gemini',
    providerLabel: 'Gemini free-tier TTS (opt-in)', gender: 'Male',
    description: 'Scottish English delivery, with conversational warmth and varied cadence.',
    edenaiProvider: 'openai', edenaiOption: 'MALE', edenaiVoiceModel: 'Charon',
    geminiVoice: 'Charon',
    speechStyle: 'A natural adult male Scottish English accent. Warm, clear and conversational, with gentle pitch variation, human pacing and natural pauses. Keep the accent authentic rather than exaggerated. Never flat or robotic. Read the transcript exactly without adding words.',
  },
];
export const TTS_VOICE_OPTIONS = [...KOKORO_VOICE_OPTIONS, ...GEMINI_VOICE_OPTIONS, ...DEEPGRAM_VOICE_OPTIONS, ...EDENAI_VOICE_OPTIONS];
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
  athena: ATHENA_CANONICAL_TTS_VOICE,
  'deepgram:athena': ATHENA_CANONICAL_TTS_VOICE,
  'deepgram/aura-2:athena': ATHENA_CANONICAL_TTS_VOICE,
  'aura-2-athena-en': ATHENA_CANONICAL_TTS_VOICE,
  apollo: 'deepgram:aura-2:apollo',
  odysseus: 'deepgram:aura-2:odysseus',
  theia: 'deepgram:aura-2:theia',
};

export function normalizeTtsProvider(provider: unknown): TTSProvider {
  const value = String(provider || '').trim().toLowerCase();
  return value === 'deepgram' || value === 'kokoro' || value === 'gemini' ? value : DEFAULT_TTS_PROVIDER;
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

export function getProviderForVoice(voice: string | undefined | null, fallback: TTSProvider = DEFAULT_TTS_PROVIDER): TTSProvider {
  return getTtsVoiceOption(voice, fallback)?.provider || fallback;
}

export function getFallbackVoiceForProvider(_provider: TTSProvider, selectedVoice?: string | null): string {
  const selected = getTtsVoiceOption(selectedVoice);
  return selected.gender === 'Male' ? 'edenai:openai:onyx' : DEFAULT_TTS_VOICE;
}

// Backward-compatible exports used by older workflow/config callers.
export function normalizePiperVoice(voice?: string | null): string { return normalizeTtsVoice(voice); }
export function normalizeEdenAIVoice(voice?: string | null): string { return normalizeTtsVoice(voice); }
export function normalizeOpenAIVoice(voice?: string | null): string { return normalizeTtsVoice(voice); }
