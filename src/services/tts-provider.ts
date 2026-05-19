import { readUserConfigSync } from '@/lib/user-config';

export type TTSProvider = 'openai' | 'inworld' | 'google' | 'elevenlabs' | 'edenai';

export interface TTSConfig {
  provider: TTSProvider;
  voice: string;
  apiKey: string;
  discordBridge: boolean;
}

export const TTS_VOICES: Record<TTSProvider, string[]> = {
  openai: ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'],
  inworld: ['Ashley', 'Marcus', 'Sarah', 'David', 'Mortimer', 'Snik', 'Hades', 'Dominus', 'Victor', 'Lucian', 'Sebastian', 'Malcolm', 'Vinny', 'Conrad', 'Damon', 'Levi', 'Theodore', 'Ronald', 'Rupert', 'Graham', 'Hank', 'Oliver', 'Simon', 'Elliot', 'James', 'Gareth', 'Nate', 'Brian', 'Ethan', 'Tyler', 'Jason', 'Jake', 'Liam', 'Callum', 'Hamish', 'Arjun', 'Craig', 'Dennis', 'Edward', 'Mark', 'Shaun', 'Timothy', 'Clive', 'Carter', 'Blake', 'Cedric', 'Jonah', 'Avery', 'Brandon', 'Trevor', 'Alex', 'Derek', 'Evan', 'Grant', 'Tristan', 'Reed', 'Duncan', 'Felix', 'Lauren', 'Jessica', 'Veronica', 'Victoria', 'Miranda', 'Kelsey', 'Kayla', 'Chloe', 'Serena', 'Celeste', 'Evelyn', 'Pippa', 'Tessa', 'Anjali', 'Saanvi', 'Claire', 'Abby', 'Luna', 'Loretta', 'Darlene', 'Marlene', 'Elizabeth', 'Julia', 'Pixie', 'Olivia', 'Priya', 'Wendy', 'Deborah', 'Hana', 'Riley', 'Mia', 'Naomi', 'Nadia', 'Selene', 'Bianca', 'Amina', 'Sophie', 'Eleanor'],
  google: ['en-US-Wavenet-F', 'en-US-Wavenet-M', 'en-GB-Wavenet-F', 'en-GB-Wavenet-M'],
  elevenlabs: ['Algieba', 'Rachel', 'Bella', 'Antoni', 'Josh', 'Arnold', 'Adam', 'Sam'],
  edenai: ['en-US-Wavenet-F']
};

function normalizeProvider(provider: unknown): TTSProvider {
  if (typeof provider !== 'string') return 'inworld';
  const normalized = provider.trim().toLowerCase();
  return normalized in TTS_VOICES ? normalized as TTSProvider : 'inworld';
}

function normalizeVoiceName(voice: string | undefined, provider: TTSProvider): string {
  const fallback = TTS_VOICES[provider][0];
  if (!voice) return fallback;

  const providerVoice = TTS_VOICES[provider].find((knownVoice) => (
    knownVoice.toLowerCase() === voice.toLowerCase()
  ));

  return providerVoice || voice;
}

export function getTTSConfig(tenantId?: string): TTSConfig {
  const config = readUserConfigSync(tenantId);
  
  const provider = normalizeProvider(config.TTS_PROVIDER);
  const voice = normalizeVoiceName(config.TTS_VOICE, provider);
  const discordBridge = config.DISCORD_TTS_BRIDGE === 'true';
  console.log('[TTS Config] provider:', provider, '| voice:', voice, '| discordBridge:', discordBridge);
  
  let apiKey = '';
  switch (provider) {
    case 'openai':
      apiKey = config.OPENAI_API_KEY || process.env.OPENAI_API_KEY || '';
      break;
    case 'inworld':
      apiKey = config.INWORLD_API_KEY || process.env.INWORLD_BASE64_API_KEY || process.env.INWORLD_API_KEY || '';
      break;
    case 'google':
      apiKey = config.GOOGLE_APPLICATION_CREDENTIALS || process.env.GOOGLE_APPLICATION_CREDENTIALS || '';
      break;
    case 'elevenlabs':
      apiKey = config.ELEVENLABS_API_KEY || process.env.ELEVENLABS_API_KEY || '';
      break;
    case 'edenai':
      apiKey = config.EDENAI_API_KEY || process.env.EDENAI_API_KEY || '';
      break;
  }
  
  console.log('[TTS Config] apiKey present:', !!apiKey, '| length:', apiKey.length);
  return { provider, voice, apiKey, discordBridge };
}

let lastTTSCall = 0;
const TTS_RATE_LIMIT = 2000; // 2 seconds between TTS calls

export async function generateTTS(text: string, voiceOverride?: string, tenantId?: string): Promise<string> {
  console.log('[TTS] generateTTS called | voiceOverride:', voiceOverride ?? '(none)', '| textLength:', text.length);
  
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
  const config: TTSConfig = voiceOverride
    ? { ...baseConfig, voice: voiceOverride }
    : baseConfig;
  
  console.log('[TTS] Final config | provider:', config.provider, '| voice:', config.voice, '| hasKey:', !!config.apiKey);
  
  if (!config.apiKey) {
    throw new Error(`No API key configured for ${config.provider} TTS`);
  }
  
  let audioDataUri: string;
  
  try {
    switch (config.provider) {
      case 'openai':
        audioDataUri = await generateOpenAITTS(text, config);
        break;
      case 'inworld':
        audioDataUri = await generateInworldTTS(text, config);
        break;
      case 'google':
        audioDataUri = await generateGoogleTTS(text, config);
        break;
      case 'elevenlabs':
        audioDataUri = await generateElevenLabsTTS(text, config);
        break;
      case 'edenai':
        audioDataUri = await generateEdenAITTS(text, config.voice, config.apiKey);
        break;
      default:
        throw new Error(`Unsupported TTS provider: ${config.provider}`);
    }
  } catch (err) {
    // Fallback to EdenAI TTS if primary provider fails
    if (config.provider !== 'edenai') {
      console.warn(`[TTS] ${config.provider} failed (voice: ${config.voice}), falling back to EdenAI:`, (err as Error).message);
      const edenKey = readUserConfigSync(tenantId).EDENAI_API_KEY || process.env.EDENAI_API_KEY || '';
      if (edenKey) {
        audioDataUri = await generateEdenAITTS(text, config.voice, edenKey);
      } else {
        throw err;
      }
    } else {
      throw err;
    }
  }
  
  console.log('[TTS] Audio generated | provider:', config.provider, '| voice:', config.voice, '| dataUri length:', audioDataUri.length);
  
  // Send to Discord if bridge is enabled
  if (config.discordBridge) {
    try {
      await sendToDiscordBridge(audioDataUri, text, config.voice);
    } catch (error) {
      console.warn('Discord bridge failed:', error);
    }
  }
  
  return audioDataUri;
}

async function generateOpenAITTS(text: string, config: TTSConfig): Promise<string> {
  const response = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'tts-1-hd',
      input: text,
      voice: config.voice,
      response_format: 'mp3',
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI TTS failed: ${response.status}`);
  }

  const audioBuffer = await response.arrayBuffer();
  const audioContent = Buffer.from(audioBuffer).toString('base64');
  return `data:audio/mpeg;base64,${audioContent}`;
}

const INWORLD_VOICES = new Set(['Ashley', 'Marcus', 'Sarah', 'David', 'Mortimer', 'Snik', 'Hades', 'Dominus', 'Victor', 'Lucian', 'Sebastian', 'Malcolm', 'Vinny', 'Conrad', 'Damon', 'Levi', 'Theodore', 'Ronald', 'Rupert', 'Graham', 'Hank', 'Oliver', 'Simon', 'Elliot', 'James', 'Gareth', 'Nate', 'Brian', 'Ethan', 'Tyler', 'Jason', 'Jake', 'Liam', 'Callum', 'Hamish', 'Arjun', 'Craig', 'Dennis', 'Edward', 'Mark', 'Shaun', 'Timothy', 'Clive', 'Carter', 'Blake', 'Cedric', 'Jonah', 'Avery', 'Brandon', 'Trevor', 'Alex', 'Derek', 'Evan', 'Grant', 'Tristan', 'Reed', 'Duncan', 'Felix', 'Lauren', 'Jessica', 'Veronica', 'Victoria', 'Miranda', 'Kelsey', 'Kayla', 'Chloe', 'Serena', 'Celeste', 'Evelyn', 'Pippa', 'Tessa', 'Anjali', 'Saanvi', 'Claire', 'Abby', 'Luna', 'Loretta', 'Darlene', 'Marlene', 'Elizabeth', 'Julia', 'Pixie', 'Olivia', 'Priya', 'Wendy', 'Deborah', 'Hana', 'Riley', 'Mia', 'Naomi', 'Nadia', 'Selene', 'Bianca', 'Amina', 'Sophie', 'Eleanor']);

async function generateInworldTTS(text: string, config: TTSConfig): Promise<string> {
  // Pass voice directly to Inworld API — let the API validate
  const voice = config.voice || 'Ashley';
  
  const response = await fetch('https://api.inworld.ai/tts/v1/voice', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${config.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text,
      voiceId: voice,
      modelId: 'inworld-tts-1.5-max'
    }),
  });

  if (!response.ok) {
    const errBody = await response.text().catch(() => '');
    throw new Error(`Inworld TTS failed: ${response.status} ${errBody}`);
  }

  const result = await response.json();
  return `data:audio/mpeg;base64,${result.audioContent}`;
}

async function generateElevenLabsTTS(text: string, config: TTSConfig): Promise<string> {
  const response = await fetch('/api/tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, voice: config.voice })
  });

  if (!response.ok) {
    throw new Error(`ElevenLabs TTS failed: ${response.status}`);
  }

  const result = await response.json();
  return result.audioDataUri;
}

async function generateGoogleTTS(text: string, config: TTSConfig): Promise<string> {
  throw new Error('Google TTS not implemented yet');
}

const VOICE_GENDER_BY_NAME = new Map<string, 'FEMALE' | 'MALE'>([
  ...['Ashley', 'Lauren', 'Jessica', 'Veronica', 'Victoria', 'Miranda', 'Kelsey', 'Kayla', 'Chloe', 'Serena', 'Celeste', 'Evelyn', 'Pippa', 'Tessa', 'Anjali', 'Saanvi', 'Claire', 'Abby', 'Luna', 'Loretta', 'Darlene', 'Marlene', 'Elizabeth', 'Julia', 'Pixie', 'Olivia', 'Priya', 'Wendy', 'Deborah', 'Hana', 'Riley', 'Mia', 'Naomi', 'Nadia', 'Selene', 'Bianca', 'Amina', 'Sophie', 'Eleanor', 'Rachel', 'Bella', 'nova', 'shimmer', 'en-US-Wavenet-F', 'en-GB-Wavenet-F'].map((voice) => [voice.toLowerCase(), 'FEMALE'] as const),
  ...['Marcus', 'David', 'Mortimer', 'Snik', 'Hades', 'Dominus', 'Victor', 'Lucian', 'Sebastian', 'Malcolm', 'Vinny', 'Conrad', 'Damon', 'Levi', 'Theodore', 'Ronald', 'Rupert', 'Graham', 'Hank', 'Oliver', 'Simon', 'Elliot', 'James', 'Gareth', 'Nate', 'Brian', 'Ethan', 'Tyler', 'Jason', 'Jake', 'Liam', 'Callum', 'Hamish', 'Arjun', 'Craig', 'Dennis', 'Edward', 'Mark', 'Shaun', 'Timothy', 'Clive', 'Carter', 'Blake', 'Cedric', 'Jonah', 'Avery', 'Brandon', 'Trevor', 'Alex', 'Derek', 'Evan', 'Grant', 'Tristan', 'Reed', 'Duncan', 'Felix', 'Antoni', 'Josh', 'Arnold', 'Adam', 'Sam', 'Algieba', 'alloy', 'echo', 'fable', 'onyx', 'en-US-Wavenet-M', 'en-GB-Wavenet-M'].map((voice) => [voice.toLowerCase(), 'MALE'] as const),
]);

function getEdenAIVoiceOption(voice: string): 'FEMALE' | 'MALE' {
  return VOICE_GENDER_BY_NAME.get(voice.toLowerCase()) || 'MALE';
}

async function generateEdenAITTS(text: string, voice: string, apiKey: string): Promise<string> {
  const gender = getEdenAIVoiceOption(voice);
  const response = await fetch('https://api.edenai.run/v2/audio/text_to_speech', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      providers: 'openai',
      language: 'en',
      text,
      option: gender,
    }),
  });

  if (!response.ok) {
    const errBody = await response.text().catch(() => '');
    throw new Error(`EdenAI TTS failed: ${response.status} ${errBody}`);
  }

  const result = await response.json();
  const audioUrl = result.openai?.audio_resource_url;
  if (!audioUrl) throw new Error('EdenAI TTS returned no audio');

  // Fetch the audio and convert to data URI
  const audioRes = await fetch(audioUrl);
  const audioBuffer = await audioRes.arrayBuffer();
  return `data:audio/mpeg;base64,${Buffer.from(audioBuffer).toString('base64')}`;
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
