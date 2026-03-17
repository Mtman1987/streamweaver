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
import { readUserConfigSync } from '@/lib/user-config';

const CONFIG_DIR = path.resolve(process.cwd(), 'config');

let cached: LocalConfigMap | null = null;
let initialized = false;
let initPromise: Promise<LocalConfigMap> | null = null;

function sectionPath(section: ConfigSectionName): string {
  return path.join(CONFIG_DIR, `${section}.json`);
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
  const tmp = `${filePath}.tmp.${process.pid}.${Date.now()}.${crypto.randomUUID()}`;
  await fsp.writeFile(tmp, JSON.stringify(data, null, 2), 'utf-8');
  await fsp.rename(tmp, filePath);
}

function defaultSection(section: ConfigSectionName): LocalConfigMap[ConfigSectionName] {
  return configSchemas[section].parse({}) as LocalConfigMap[ConfigSectionName];
}

function generateApiKey(): string {
  return crypto.randomBytes(24).toString('hex');
}

function migrateFromLegacy(config: LocalConfigMap): LocalConfigMap {
  const legacyUserConfig = readUserConfigSync();

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
        host: '127.0.0.1',
      },
      security: {
        ...config.app.security,
        apiKey: parseApiKey(config.app.security.apiKey) || parseApiKey(process.env.STREAMWEAVER_API_KEY) || generateApiKey(),
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
    redeems: configSchemas.redeems.parse(config.redeems || {}),
  };
}

export async function initializeLocalConfig(): Promise<LocalConfigMap> {
  if (initialized && cached) return cached;

  if (initPromise) return initPromise;

  initPromise = (async () => {
    await fsp.mkdir(CONFIG_DIR, { recursive: true });

    const draft = {} as LocalConfigMap;
    for (const section of configFileOrder) {
      const filePath = sectionPath(section);
      try {
        const raw = await fsp.readFile(filePath, 'utf-8');
        draft[section] = configSchemas[section].parse(JSON.parse(raw)) as any;
      } catch {
        draft[section] = defaultSection(section) as any;
      }
    }

    const migrated = migrateFromLegacy(draft);

    for (const section of configFileOrder) {
      await writeJsonAtomic(sectionPath(section), migrated[section]);
    }

    cached = migrated;
    initialized = true;
    return migrated;
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
  const cfg = await getConfigSection('app');
  if (!cfg.security.requireApiKey) return true;
  const provided = apiKey || '';
  const configuredKey = parseApiKey(cfg.security.apiKey);
  const envFallbackKey = parseApiKey(process.env.STREAMWEAVER_API_KEY);

  if (configuredKey && provided === configuredKey) return true;
  if (envFallbackKey && provided === envFallbackKey) return true;
  return false;
}

export async function isDebugRoutesEnabled(): Promise<boolean> {
  const cfg = await getConfigSection('app');
  return Boolean(cfg.security.allowDebugRoutes);
}

export function validateLocalApiKeySync(apiKey?: string | null): boolean {
  try {
    const filePath = sectionPath('app');
    if (!fs.existsSync(filePath)) return false;
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = configSchemas.app.parse(JSON.parse(raw));
    if (!parsed.security.requireApiKey) return true;
    const provided = apiKey || '';
    const configuredKey = parseApiKey(parsed.security.apiKey);
    const envFallbackKey = parseApiKey(process.env.STREAMWEAVER_API_KEY);
    return Boolean((configuredKey && provided === configuredKey) || (envFallbackKey && provided === envFallbackKey));
  } catch {
    return false;
  }
}

export function getConfigDirectoryPath(): string {
  return CONFIG_DIR;
}
