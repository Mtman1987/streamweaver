import { generateAIResponse } from '@/services/ai-provider';
import { readGenerationSettings, type GenerationSettings } from '@/lib/gen-settings-store';
import { getInternalAppUrl } from '@/lib/runtime-origin';

type ProviderMode = GenerationSettings['mode'];

export type ParsedImageCommand = {
  prompt: string;
  raw: boolean;
  count?: number;
  provider?: ProviderMode;
};

export type ImageCommandResult = {
  prompt: string;
  originalPrompt: string;
  optimizedPrompt: string | null;
  provider?: string;
  images: string[];
};

export type ImageCommandOptions = {
  scope?: 'public' | 'private';
};

function clampCount(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(4, Math.floor(parsed)));
}

export function parseImageCommand(input: string): ParsedImageCommand {
  let value = String(input || '').replace(/^!img\s*/i, '').trim();
  let raw = false;
  let provider: ProviderMode | undefined;
  let count: number | undefined;

  const consume = (pattern: RegExp, handler: (match: RegExpMatchArray) => void) => {
    const match = value.match(pattern);
    if (!match) return false;
    handler(match);
    value = value.replace(pattern, '').trim();
    return true;
  };

  let changed = true;
  while (changed) {
    changed = false;
    changed = consume(/^--raw\b/i, () => { raw = true; }) || changed;
    changed = consume(/^raw:\s*/i, () => { raw = true; }) || changed;
    changed = consume(/^--count\s+([1-4])\b/i, (match) => { count = clampCount(match[1], 1); }) || changed;
    changed = consume(/^-n\s+([1-4])\b/i, (match) => { count = clampCount(match[1], 1); }) || changed;
    changed = consume(/^--(seaart|eden|perchance|pollinations|free)\b/i, (match) => {
      provider = match[1].toLowerCase() === 'free' ? 'pollinations' : match[1].toLowerCase() as ProviderMode;
    }) || changed;
    changed = consume(/^([1-4])\s+/, (match) => { count = clampCount(match[1], 1); }) || changed;
  }

  return { prompt: value, raw, count, provider };
}

export async function optimizeImagePrompt(
  prompt: string,
  settings: GenerationSettings,
  tenantId?: string,
): Promise<string> {
  const optimized = await generateAIResponse(
    `User idea:\n${prompt}`,
    settings.imagePromptTemplate,
    tenantId,
    { maxTokens: 180, temperature: 0.75 },
  );
  const cleaned = optimized
    .replace(/^["'`\s]+|["'`\s]+$/g, '')
    .replace(/^final prompt:\s*/i, '')
    .trim();
  if (!cleaned || cleaned === 'AI response failed') return prompt;
  return cleaned.slice(0, 3000);
}

export async function runImageCommand(input: string, tenantId: string, options: ImageCommandOptions = {}): Promise<ImageCommandResult> {
  const parsed = parseImageCommand(input);
  if (!parsed.prompt) {
    return {
      prompt: '',
      originalPrompt: '',
      optimizedPrompt: null,
      images: [],
    };
  }

  const settings = await readGenerationSettings(tenantId);
  const shouldOptimize = settings.optimizeImagePrompts && !parsed.raw;
  const finalPrompt = shouldOptimize
    ? await optimizeImagePrompt(parsed.prompt, settings, tenantId).catch((error) => {
        console.warn('[Image Command] prompt optimization failed:', error);
        return parsed.prompt;
      })
    : parsed.prompt;

  const imageRes = await fetch(`${getInternalAppUrl()}/api/ai/image`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt: finalPrompt,
      tenantId,
      model: settings.model || undefined,
      resolution: settings.resolution || undefined,
      numImages: parsed.count || settings.imageCount || 1,
      scope: options.scope || 'public',
      providerParams: {
        lora: settings.lora || undefined,
        loraStrength: settings.lora ? settings.loraStrength : undefined,
        steps: settings.steps,
        cfg: settings.cfg,
        seed: settings.seed,
        ...(parsed.provider ? { providerOverride: parsed.provider } : {}),
      },
      ...(parsed.provider ? { providerOverride: parsed.provider } : {}),
    }),
  });

  if (!imageRes.ok) {
    const errText = await imageRes.text().catch(() => '');
    throw new Error(`Image generation failed: ${imageRes.status} ${errText.slice(0, 400)}`);
  }

  const imageData = await imageRes.json();
  const images = [
    ...(Array.isArray(imageData?.images) ? imageData.images : []),
    imageData?.image,
    imageData?.imageResourceUrl,
    imageData?.data?.image,
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .filter((value, index, all) => all.indexOf(value) === index);

  // Only return the locally-stored URL if available (prefer /api/ai/image/file/ over CDN)
  const localImage = images.find((url) => url.includes('/api/ai/image/file/'));
  const finalImages = localImage ? [localImage] : images.slice(0, 1);

  return {
    prompt: finalPrompt,
    originalPrompt: parsed.prompt,
    optimizedPrompt: finalPrompt !== parsed.prompt ? finalPrompt : null,
    provider: imageData?.provider || parsed.provider || settings.mode,
    images: finalImages,
  };
}
