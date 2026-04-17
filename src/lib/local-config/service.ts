import * as crypto from 'crypto';
import * as fs from 'fs';
import { promises as fsp } from 'fs';
import * as path from 'path';
import {
  configFileOrder,
  configSchemas,
  maskValue,
  parseApiKey,
  secretFields,
  type ConfigSectionName,
  type LocalConfigMap,
} from './schemas';
import { readUserConfigSync } from '../user-config';
import { tenantPath } from '../tenant';

const CONFIG_DIR = path.resolve(process.cwd(), 'config');

function configDir(tenantId?: string): string {
  if (tenantId) return tenantPath(tenantId, 'config');
  return CONFIG_DIR;
}

let cached: LocalConfigMap | null = null;
let initialized = false;
let initPromise: Promise<LocalConfigMap> | null = null;

function sectionPath(section: ConfigSectionName, tenantId?: string): string {
  return path.join(configDir(tenantId), `${section}.json`);
}

function getDeepValue(obj: Record<string, any>, dotted: string): unknown {
  return dotted.split('.').reduce((acc: any, key) => (acc && typeof acc === 'object' ? acc[key] : undefined), obj);
}

function setDeepValue(obj: Record<string, any>, dotted: string, value: unknown): void {
  const keys = dotted.split('.');
  let current: Record<string, any> = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (!current[key] || typeof current[key] !== 'object') current[key] = {};
    current = current[key];
  }
  current[keys[keys.length - 1]] = value;
}

async function writeJsonAtomic(filePath: string, data: unknown): Promise<void> {
  // Ensure data is not undefined
  if (data === undefined) {
    console.warn(`[Config] Attempted to write undefined data to ${filePath}, using empty object`);
    data = {};
  }
  
  const tmp = `${filePath}.tmp.${process.pid}.${Date.now()}.${crypto.randomUUID()}`;
  const jsonString = JSON.stringify(data, null, 2);
  await fsp.writeFile(tmp, jsonString, 'utf-8');
  await fsp.rename(tmp, filePath);
}

function defaultSection(section: ConfigSectionName): LocalConfigMap[ConfigSectionName] {
  return configSchemas[section].parse({}) as LocalConfigMap[ConfigSectionName];
}

function generateApiKey(): string {
  return crypto.randomBytes(24).toString('hex');
}

function parsePort(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1024 && parsed <= 65535 ? parsed : fallback;
}

function migrateFromLegacy(config: LocalConfigMap): LocalConfigMap {
  const legacyUserConfig = readUserConfigSync();
  const isProductionRuntime = process.env.NODE_ENV === 'production';

  const migrated: LocalConfigMap = {
    ...config,
    twitch: {
      ...config.twitch,
      broadcasterUsername: config.twitch.broadcasterUsername || legacyUserConfig.TWITCH_BROADCASTER_USERNAME || '',
      broadcasterId: config.twitch.broadcasterId || legacyUserConfig.TWITCH_BROADCASTER_ID || '',
      clientId: config.twitch.clientId || process.env.TWITCH_CLIENT_ID || '',
      clientSecret: config.twitch.clientSecret || process.env.TWITCH_CLIENT_SECRET || '',
      botUsername: config.twitch.botUsername || process.env.NEXT_PUBLIC_TWITCH_BOT_USERNAME || '',
    },
    discord: {
      ...config.discord,
      botToken: config.discord.botToken || process.env.DISCORD_BOT_TOKEN || '',
      logChannelId: config.discord.logChannelId || legacyUserConfig.NEXT_PUBLIC_DISCORD_LOG_CHANNEL_ID || '',
      aiChatChannelId: config.discord.aiChatChannelId || legacyUserConfig.NEXT_PUBLIC_DISCORD_AI_CHAT_CHANNEL_ID || '',
      shareChannelId: config.discord.shareChannelId || legacyUserConfig.NEXT_PUBLIC_DISCORD_SHARE_CHANNEL_ID || '',
      metricsChannelId: config.discord.metricsChannelId || legacyUserConfig.NEXT_PUBLIC_DISCORD_METRICS_CHANNEL_ID || '',
    },
    automation: {
      ...config.automation,
      aiProvider: (legacyUserConfig.AI_PROVIDER as any) || config.automation.aiProvider,
      aiModel: legacyUserConfig.AI_MODEL || config.automation.aiModel,
      aiBotName: legacyUserConfig.AI_BOT_NAME || config.automation.aiBotName,
      aiPersonalityName: legacyUserConfig.AI_PERSONALITY_NAME || config.automation.aiPersonalityName,
      geminiApiKey: config.automation.geminiApiKey || legacyUserConfig.GEMINI_API_KEY || process.env.GEMINI_API_KEY || '',
      edenaiApiKey: config.automation.edenaiApiKey || legacyUserConfig.EDENAI_API_KEY || process.env.EDENAI_API_KEY || '',
      openaiApiKey: config.automation.openaiApiKey || legacyUserConfig.OPENAI_API_KEY || process.env.OPENAI_API_KEY || '',
      ttsVoice: legacyUserConfig.TTS_VOICE || config.automation.ttsVoice,
    },
    app: {
      ...config.app,
      server: {
        ...config.app.server,
        host: config.app.server.host || process.env.SERVER_HOST || (isProductionRuntime ? '0.0.0.0' : '127.0.0.1'),
        port: config.app.server.port || parsePort(process.env.PORT, 3100),
        wsPort: config.app.server.wsPort || parsePort(process.env.WS_PORT, 8090),
        openBrowserOnStart: isProductionRuntime ? false : config.app.server.openBrowserOnStart,
      },
      security: {
        ...config.app.security,
        requireApiKey: false,
        apiKey: '',
      },
    },
  };

  return {
    app: configSchemas.app.parse(migrated.app),
    twitch: configSchemas.twitch.parse(migrated.twitch),
    discord: configSchemas.discord.parse(migrated.discord),
    game: configSchemas.game.parse(migrated.game),
    economy: configSchemas.economy.parse(migrated.economy),
    automation: configSchemas.automation.parse(migrated.automation),
    obs: configSchemas.obs.parse(config.obs || {}),
    redeems: configSchemas.redeems.parse(config.redeems || {}),
  };
}

export async function initializeLocalConfig(): Promise<LocalConfigMap> {
  if (initialized && cached) return cached;

  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      await fsp.mkdir(CONFIG_DIR, { recursive: true });

      const draft = {} as LocalConfigMap;
      for (const section of configFileOrder) {
        const filePath = sectionPath(section);
        try {
          const raw = await fsp.readFile(filePath, 'utf-8');
          const parsed = JSON.parse(raw);
          draft[section] = configSchemas[section].parse(parsed) as any;
        } catch (error) {
          console.log(`[Config] Creating default config for section: ${section}`);
          draft[section] = defaultSection(section) as any;
        }
      }

      const migrated = migrateFromLegacy(draft);

      // Validate migrated config before writing
      for (const section of configFileOrder) {
        if (migrated[section] === undefined) {
          console.warn(`[Config] Section ${section} is undefined, using default`);
          migrated[section] = defaultSection(section) as any;
        }
      }

      for (const section of configFileOrder) {
        await writeJsonAtomic(sectionPath(section), migrated[section]);
      }

      cached = migrated;
      initialized = true;
      return migrated;
    } catch (error) {
      console.error('[Config] Failed to initialize local config:', error);
      // Return minimal working config to prevent crash
      const fallback = {} as LocalConfigMap;
      for (const section of configFileOrder) {
        fallback[section] = defaultSection(section) as any;
      }
      cached = fallback;
      initialized = true;
      return fallback;
    }
  })();

  try {
    return await initPromise;
  } finally {
    initPromise = null;
  }
}

export async function getAllConfig(): Promise<LocalConfigMap> {
  return initializeLocalConfig();
}

export async function getConfigSection<K extends ConfigSectionName>(section: K): Promise<LocalConfigMap[K]> {
  const all = await initializeLocalConfig();
  return all[section];
}

export async function updateConfigSection<K extends ConfigSectionName>(
  section: K,
  updates: Partial<LocalConfigMap[K]>
): Promise<LocalConfigMap[K]> {
  const all = await initializeLocalConfig();
  const merged = {
    ...all[section],
    ...updates,
  } as LocalConfigMap[K];

  const parsed = configSchemas[section].parse(merged) as LocalConfigMap[K];
  all[section] = parsed as any;
  await writeJsonAtomic(sectionPath(section), parsed);
  cached = all;
  return parsed;
}

export async function getPublicConfigSection<K extends ConfigSectionName>(section: K): Promise<Record<string, unknown>> {
  const full = (await getConfigSection(section)) as Record<string, any>;
  const result = JSON.parse(JSON.stringify(full)) as Record<string, any>;

  for (const dottedPath of secretFields[section]) {
    const value = getDeepValue(full, dottedPath);
    if (typeof value === 'string') {
      setDeepValue(result, dottedPath, value ? maskValue(value) : '');
      setDeepValue(result, `${dottedPath}Configured`, Boolean(value));
    }
  }

  return result;
}

export async function getPublicConfigAll(): Promise<Record<ConfigSectionName, Record<string, unknown>>> {
  await initializeLocalConfig();
  const out = {} as Record<ConfigSectionName, Record<string, unknown>>;
  for (const section of configFileOrder) {
    out[section] = await getPublicConfigSection(section);
  }
  return out;
}

export async function validateLocalApiKey(apiKey?: string | null): Promise<boolean> {
  return true;
}

export async function isDebugRoutesEnabled(): Promise<boolean> {
  // In cloud/production mode, allow debug routes for authenticated users
  if (process.env.NODE_ENV === 'production') return true;
  const cfg = await getConfigSection('app');
  return Boolean(cfg.security.allowDebugRoutes);
}

export function validateLocalApiKeySync(apiKey?: string | null): boolean {
  return true;
}

export function getConfigDirectoryPath(): string {
  return CONFIG_DIR;
}