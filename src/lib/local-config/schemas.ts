import { z } from 'zod';

const nonEmpty = z.string().trim().min(1);

export const appConfigSchema = z.object({
  server: z.object({
    host: z.string().trim().min(1).default(process.env.SERVER_HOST || '127.0.0.1'),
    port: z.number().int().min(1024).max(65535).default(3100),
    wsPort: z.number().int().min(1024).max(65535).default(8090),
    openBrowserOnStart: z.boolean().default(true),
  }).default({}),
  security: z.object({
    requireApiKey: z.boolean().default(true),
    apiKey: z.string().default(''),
    allowDebugRoutes: z.boolean().default(false),
  }).default({}),
  logging: z.object({
    level: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
    redactSensitiveLogs: z.boolean().default(true),
  }).default({}),
});

export const twitchConfigSchema = z.object({
  clientId: z.string().default(''),
  clientSecret: z.string().default(''),
  broadcasterUsername: z.string().default(''),
  broadcasterId: z.string().default(''),
  botUsername: z.string().default(''),
});

export const discordConfigSchema = z.object({
  botToken: z.string().default(''),
  logChannelId: z.string().default(''),
  aiChatChannelId: z.string().default(''),
  shareChannelId: z.string().default(''),
  metricsChannelId: z.string().default(''),
});

export const gameConfigSchema = z.object({
  classicGamble: z.object({
    minBet: z.number().int().min(0).default(10),
    maxBet: z.number().int().min(0).default(50000),
    jackpotPercent: z.number().int().min(1).max(99).default(3),
    winPercent: z.number().int().min(1).max(99).default(38),
  }).default({}),
});

export const economyConfigSchema = z.object({
  points: z.object({
    minChatPoints: z.number().int().min(0).default(10),
    maxChatPoints: z.number().int().min(0).default(15),
    chatCooldownSeconds: z.number().int().min(1).default(15),
  }).default({}),
});

export const automationConfigSchema = z.object({
  aiProvider: z.enum(['gemini', 'edenai', 'openai']).default('gemini'),
  aiModel: z.string().default(''),
  aiBotName: z.string().default('Athena'),
  aiPersonalityName: z.string().default('Commander'),
  geminiApiKey: z.string().default(''),
  edenaiApiKey: z.string().default(''),
  openaiApiKey: z.string().default(''),
  ttsProvider: z.enum(['google', 'openai', 'inworld']).default('google'),
  ttsVoice: z.string().default('Algieba'),
});

const customRewardSchema = z.object({
  pointCost: z.number().int().default(0),
  response: z.string().default(''),
});

export const redeemsConfigSchema = z.object({
  partnerCheckin: z.object({
    rewardTitle: z.string().default(''),
    pointCost: z.number().int().default(0),
    discordGuildId: z.string().default(''),
    discordRoleName: z.string().default(''),
  }).default({}),
  pokePack: z.object({
    rewardTitle: z.string().default(''),
    pointCost: z.number().int().default(1500),
    enabledSets: z.array(z.string()).default(['base1','base2','base3','base4','base5','gym1']),
  }).default({}),
  customRewards: z.record(z.string(), customRewardSchema).default({}),
});

export const configSchemas = {
  app: appConfigSchema,
  twitch: twitchConfigSchema,
  discord: discordConfigSchema,
  game: gameConfigSchema,
  economy: economyConfigSchema,
  automation: automationConfigSchema,
  redeems: redeemsConfigSchema,
};

export type AppConfig = z.infer<typeof appConfigSchema>;
export type TwitchConfig = z.infer<typeof twitchConfigSchema>;
export type DiscordConfig = z.infer<typeof discordConfigSchema>;
export type GameConfig = z.infer<typeof gameConfigSchema>;
export type EconomyConfig = z.infer<typeof economyConfigSchema>;
export type AutomationConfig = z.infer<typeof automationConfigSchema>;
export type RedeemsConfig = z.infer<typeof redeemsConfigSchema>;

export type ConfigSectionName = keyof typeof configSchemas;
export type LocalConfigMap = {
  app: AppConfig;
  twitch: TwitchConfig;
  discord: DiscordConfig;
  game: GameConfig;
  economy: EconomyConfig;
  automation: AutomationConfig;
  redeems: RedeemsConfig;
};

export const secretFields: Record<ConfigSectionName, string[]> = {
  app: ['security.apiKey'],
  twitch: ['clientSecret'],
  discord: ['botToken'],
  game: [],
  economy: [],
  automation: ['geminiApiKey', 'edenaiApiKey', 'openaiApiKey'],
  redeems: [],
};

export const configFileOrder: ConfigSectionName[] = [
  'app',
  'twitch',
  'discord',
  'game',
  'economy',
  'automation',
  'redeems',
];

export function maskValue(value: string): string {
  if (!value) return '';
  if (value.length <= 4) return '****';
  return `${'*'.repeat(Math.min(8, value.length - 4))}${value.slice(-4)}`;
}

export function parseApiKey(value: unknown): string {
  const parsed = nonEmpty.safeParse(value);
  return parsed.success ? parsed.data : '';
}