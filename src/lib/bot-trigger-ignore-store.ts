import { promises as fs } from 'fs';
import { resolve } from 'path';
import { globalPath, tenantPath } from '@/lib/tenant';

export type BotTriggerIgnoreConfig = {
  all: boolean;
  bots: string[];
};

export type BotTriggerRef = {
  tenantId?: string;
  stableId?: string;
  botName?: string;
  trigger?: string;
};

function configPath(tenantId?: string): string {
  if (tenantId) return tenantPath(tenantId, 'data/bot-trigger-ignore.json');
  return globalPath('bot-trigger-ignore.json');
}

function normalize(value: string | undefined): string {
  return String(value || '')
    .toLowerCase()
    .trim()
    .replace(/^@/, '')
    .replace(/\s+/g, ' ');
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.map(normalize).filter(Boolean))).sort();
}

function labelsForBot(bot: BotTriggerRef): string[] {
  return unique([
    bot.stableId || '',
    bot.botName || '',
    bot.trigger || '',
    bot.tenantId && bot.botName ? `${bot.tenantId}:${bot.botName}` : '',
  ]);
}

export async function getBotTriggerIgnoreConfig(tenantId?: string): Promise<BotTriggerIgnoreConfig> {
  try {
    const parsed = JSON.parse(await fs.readFile(configPath(tenantId), 'utf-8'));
    return {
      all: parsed?.all === true,
      bots: unique(Array.isArray(parsed?.bots) ? parsed.bots : []),
    };
  } catch {
    return { all: false, bots: [] };
  }
}

async function saveBotTriggerIgnoreConfig(config: BotTriggerIgnoreConfig, tenantId?: string): Promise<BotTriggerIgnoreConfig> {
  const next = { all: config.all === true, bots: unique(config.bots) };
  const filePath = configPath(tenantId);
  await fs.mkdir(resolve(filePath, '..'), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(next, null, 2));
  return next;
}

export async function toggleBotTriggerIgnoreAll(tenantId?: string): Promise<BotTriggerIgnoreConfig> {
  const config = await getBotTriggerIgnoreConfig(tenantId);
  return saveBotTriggerIgnoreConfig({ ...config, all: !config.all }, tenantId);
}

export async function toggleIgnoredBotTrigger(bot: BotTriggerRef, tenantId?: string): Promise<{ ignored: boolean; label: string; config: BotTriggerIgnoreConfig }> {
  const labels = labelsForBot(bot);
  const label = labels[0] || normalize(bot.botName || bot.trigger);
  const config = await getBotTriggerIgnoreConfig(tenantId);
  const ignored = !labels.some((value) => config.bots.includes(value));
  const bots = ignored
    ? unique([...config.bots, ...labels])
    : config.bots.filter((value) => !labels.includes(value));
  return { ignored, label, config: await saveBotTriggerIgnoreConfig({ ...config, bots }, tenantId) };
}

export async function isBotTriggerIgnored(bot: BotTriggerRef, tenantId?: string): Promise<boolean> {
  const config = await getBotTriggerIgnoreConfig(tenantId);
  if (config.all) return true;
  const labels = labelsForBot(bot);
  return labels.some((label) => config.bots.includes(label));
}
