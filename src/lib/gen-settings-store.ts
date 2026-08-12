import { promises as fs } from 'fs';
import { resolve } from 'path';
import { tenantPath } from '@/lib/tenant';

export type GenerationSettings = {
  mode: 'cloudflare' | 'eden' | 'seaart' | 'perchance' | 'pollinations';
  publicImageAccess: 'everyone' | 'mods' | 'off';
  publicContentModeration: boolean;
  privateContentModeration: boolean;
  model: string;
  seaartCharacterId: string;
  lora: string;
  loraStrength: number;
  imageCount: number;
  resolution: string;
  steps: number;
  cfg: number;
  seed: number;
  optimizeImagePrompts: boolean;
  showOptimizedPrompt: boolean;
  imagePromptTemplate: string;
};

export const IMAGE_PROMPT_TEMPLATES: Record<string, string> = {
  general: [
    'Rewrite the user idea into one concise image-generation prompt.',
    'Preserve the user intent exactly. Do not add unrelated subjects.',
    'Add visual detail: medium/style, composition, lighting, background, mood, color, quality cues.',
    'Return only the final prompt. No quotes, labels, markdown, or explanation.',
  ].join('\n'),
  anime: [
    'Rewrite the user idea into a tag-based anime image prompt.',
    'Preserve the user intent exactly. Do not add unrelated subjects.',
    'Use danbooru-style tags: subject, hair, eyes, outfit, pose, background, lighting, quality tags like masterpiece, best quality.',
    'Return only the final prompt. No quotes, labels, markdown, or explanation.',
  ].join('\n'),
  photo: [
    'Rewrite the user idea into a photorealistic image prompt.',
    'Preserve the user intent exactly. Do not add unrelated subjects.',
    'Add photography detail: camera type, lens, aperture, lighting setup, environment, color grading.',
    'Return only the final prompt. No quotes, labels, markdown, or explanation.',
  ].join('\n'),
  avatar: [
    'Rewrite the user idea into a character avatar prompt.',
    'Preserve the user intent exactly. Do not add unrelated subjects.',
    'Focus on clean character framing, upper body or portrait composition, simple or stylized background.',
    'Return only the final prompt. No quotes, labels, markdown, or explanation.',
  ].join('\n'),
};

export const DEFAULT_IMAGE_PROMPT_TEMPLATE = IMAGE_PROMPT_TEMPLATES.general;

const defaults: GenerationSettings = {
  mode: 'cloudflare',
  publicImageAccess: 'everyone',
  publicContentModeration: true,
  privateContentModeration: false,
  model: '',
  seaartCharacterId: '',
  lora: '',
  loraStrength: 0.7,
  imageCount: 1,
  resolution: '1024x1024',
  steps: 30,
  cfg: 7,
  seed: 0,
  optimizeImagePrompts: true,
  showOptimizedPrompt: false,
  imagePromptTemplate: DEFAULT_IMAGE_PROMPT_TEMPLATE,
};

function filePath(tenantId?: string): string {
  if (tenantId) return tenantPath(tenantId, 'data/gen-settings.json');
  return resolve(process.cwd(), 'data', 'gen-settings.json');
}

export function getDefaultGenerationSettings(): GenerationSettings {
  return { ...defaults };
}

function sanitize(input: Partial<GenerationSettings>): GenerationSettings {
  const mode = input.mode === 'cloudflare' || input.mode === 'seaart' || input.mode === 'perchance' || input.mode === 'pollinations'
    ? input.mode
    : input.mode === 'eden'
      ? 'eden'
      : defaults.mode;
  const publicImageAccess = input.publicImageAccess === 'mods' || input.publicImageAccess === 'off'
    ? input.publicImageAccess
    : 'everyone';
  const imageCount = Math.max(1, Math.min(4, Number(input.imageCount || defaults.imageCount) || defaults.imageCount));
  const loraStrength = Math.max(0, Math.min(2, Number(input.loraStrength ?? defaults.loraStrength) || 0));
  const steps = Math.max(1, Math.min(150, Number(input.steps || defaults.steps) || defaults.steps));
  const cfg = Math.max(1, Math.min(30, Number(input.cfg || defaults.cfg) || defaults.cfg));
  const seed = Math.max(0, Math.floor(Number(input.seed || 0) || 0));

  return {
    mode,
    publicImageAccess,
    publicContentModeration: input.publicContentModeration !== false,
    privateContentModeration: input.privateContentModeration === true,
    model: String(input.model || '').trim(),
    seaartCharacterId: String(input.seaartCharacterId || '').trim(),
    lora: String(input.lora || '').trim(),
    loraStrength,
    imageCount,
    resolution: String(input.resolution || defaults.resolution).trim() || defaults.resolution,
    steps,
    cfg,
    seed,
    optimizeImagePrompts: input.optimizeImagePrompts !== false,
    showOptimizedPrompt: input.showOptimizedPrompt === true,
    imagePromptTemplate: String(input.imagePromptTemplate || defaults.imagePromptTemplate).trim() || defaults.imagePromptTemplate,
  };
}

export async function readGenerationSettings(tenantId?: string): Promise<GenerationSettings> {
  try {
    const raw = await fs.readFile(filePath(tenantId), 'utf-8');
    return sanitize(JSON.parse(raw));
  } catch {
    return getDefaultGenerationSettings();
  }
}

export async function writeGenerationSettings(next: Partial<GenerationSettings>, tenantId?: string): Promise<GenerationSettings> {
  const merged = sanitize({ ...(await readGenerationSettings(tenantId)), ...next });
  const fp = filePath(tenantId);
  await fs.mkdir(resolve(fp, '..'), { recursive: true });
  await fs.writeFile(fp, JSON.stringify(merged, null, 2), 'utf-8');
  return merged;
}
