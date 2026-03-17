import { promises as fs } from 'fs';
import { resolve } from 'path';

export interface AppConfig {
  // OAuth Client IDs (can be public)
  twitchClientId?: string;
  discordClientId?: string;
  youtubeClientId?: string;
  
  // API Keys (stored securely)
  geminiApiKey?: string;
  edenaiApiKey?: string;
  openaiApiKey?: string;
  inworldApiKey?: string;
  
  // Bot Tokens (optional - defaults provided)
  discordBotToken?: string;
  
  // OBS Configuration
  obsWsUrl?: string;
  obsWsPassword?: string;
  
  // Scene/Source Names (optional - defaults provided)
  shoutoutScene?: string;
  shoutoutBrowserSource?: string;
  brbScene?: string;
  brbBrowserSource?: string;
  gambleOverlayScene?: string;
  gambleOverlaySource?: string;
  shoutoutIntroMessage?: string;
  
  // Discord Configuration (optional)
  discordLogChannelId?: string;
  discordAiChatChannelId?: string;
  discordWebhookUrl?: string;
  
  // TTS Configuration (optional - defaults provided)
  useTtsPlayer?: boolean;
  defaultTtsVoice?: string;
  
  // Google Cloud (optional)
  googleApplicationCredentials?: string;
  googleServiceAccountJson?: string;
}

// Default values
const DEFAULTS = {
  // Twitch OAuth - works out of the box, users can optionally use their own
  twitchClientId: 'your_default_twitch_client_id',
  
  // Discord OAuth - works out of the box, users can optionally use their own  
  discordClientId: 'your_default_discord_client_id',
  
  // Bot info - same for everyone unless they want custom
  discordBotToken: 'MTM0MDMxNTM3Nzc3NDc1NTg5MA.GvKxOx.defaultbottoken', // Default StreamWeaver bot
  
  // Scene/Source defaults
  shoutoutScene: 'Shoutout',
  shoutoutBrowserSource: 'Shoutout-Player',
  brbScene: 'BRB',
  brbBrowserSource: 'ClipPlayer',
  gambleOverlayScene: 'Alerts',
  gambleOverlaySource: 'gamble',
  shoutoutIntroMessage: 'Shoutout: go check out @{displayName} at https://twitch.tv/{displayName}',
  
  // TTS defaults
  useTtsPlayer: true,
  defaultTtsVoice: 'Algieba',
  
  // OBS defaults
  obsWsUrl: 'ws://127.0.0.1:4455',
};

const CONFIG_PATH = resolve(process.cwd(), 'tokens', 'app-config.json');

let cachedConfig: AppConfig | null = null;

export async function getAppConfig(): Promise<AppConfig> {
  if (cachedConfig) return { ...DEFAULTS, ...cachedConfig };
  
  try {
    const data = await fs.readFile(CONFIG_PATH, 'utf-8');
    cachedConfig = JSON.parse(data);
    return { ...DEFAULTS, ...cachedConfig };
  } catch {
    return DEFAULTS;
  }
}

export async function updateAppConfig(updates: Partial<AppConfig>): Promise<void> {
  const current = await getAppConfig();
  const updated = { ...current, ...updates };
  
  try {
    await fs.mkdir(resolve(process.cwd(), 'tokens'), { recursive: true });
    await fs.writeFile(CONFIG_PATH, JSON.stringify(updated, null, 2));
    cachedConfig = updated;
  } catch (error) {
    console.error('Failed to update app config:', error);
    throw error;
  }
}

// Helper to get config value with defaults and env fallback (for migration)
export async function getConfigValue(key: keyof AppConfig, envKey?: string): Promise<string | undefined> {
  const config = await getAppConfig();
  const value = config[key];
  return typeof value === 'string' ? value : (envKey ? process.env[envKey] : undefined);
}
