import sharp from 'sharp';
import type { ImageGenerationOptions, ImageGenerationResult } from './image-provider';

export const DEFAULT_CLOUDFLARE_IMAGE_MODEL = '@cf/black-forest-labs/flux-2-klein-4b';
export const DEFAULT_CLOUDFLARE_PRIVATE_IMAGE_MODEL = '@cf/black-forest-labs/flux-2-klein-4b';

const PUBLIC_MODELS = new Set([
  '@cf/black-forest-labs/flux-2-klein-4b',
  '@cf/black-forest-labs/flux-1-schnell',
  '@cf/leonardo/lucid-origin',
  '@cf/leonardo/phoenix-1.0',
]);

const PRIVATE_MODELS = new Set([
  ...PUBLIC_MODELS,
  '@cf/black-forest-labs/flux-2-klein-9b',
]);

export class CloudflareWorkersAIUnavailableError extends Error {
  constructor(message = 'Cloudflare Workers AI is not configured') {
    super(message);
    this.name = 'CloudflareWorkersAIUnavailableError';
  }
}

function parseResolution(resolution?: string): { width: number; height: number } {
  const value = String(resolution || '').trim().toLowerCase();
  const explicit = value.match(/^(\d{3,4})\s*x\s*(\d{3,4})$/);
  if (explicit) {
    return {
      width: Math.max(256, Math.min(1920, Number(explicit[1]))),
      height: Math.max(256, Math.min(1920, Number(explicit[2]))),
    };
  }
  if (value === 'landscape') return { width: 1024, height: 768 };
  if (value === 'portrait') return { width: 768, height: 1024 };
  return { width: 1024, height: 1024 };
}

function credential(name: 'CLOUDFLARE_ACCOUNT_ID' | 'CLOUDFLARE_API_TOKEN'): string {
  return String(process.env[name] || '').trim();
}

function normalizeModel(value: unknown, scope: 'public' | 'private'): string {
  const fallback = scope === 'private'
    ? String(process.env.CLOUDFLARE_PRIVATE_IMAGE_MODEL || DEFAULT_CLOUDFLARE_PRIVATE_IMAGE_MODEL).trim()
    : String(process.env.CLOUDFLARE_IMAGE_MODEL || DEFAULT_CLOUDFLARE_IMAGE_MODEL).trim();
  const requested = String(value || fallback).trim() || fallback;
  const allowed = scope === 'private' ? PRIVATE_MODELS : PUBLIC_MODELS;
  if (allowed.has(requested)) return requested;
  console.warn(`[Cloudflare Image] Model ${requested} is not allowed for ${scope} scope; using ${fallback}.`);
  return allowed.has(fallback) ? fallback : DEFAULT_CLOUDFLARE_IMAGE_MODEL;
}

async function referenceBytes(value: string): Promise<Buffer | null> {
  try {
    let bytes: Buffer;
    if (/^data:image\//i.test(value)) {
      const match = value.match(/^data:image\/[^;]+;base64,(.+)$/i);
      if (!match) return null;
      bytes = Buffer.from(match[1], 'base64');
    } else if (/^https?:\/\//i.test(value)) {
      const response = await fetch(value, { signal: AbortSignal.timeout(15000) });
      if (!response.ok) return null;
      bytes = Buffer.from(await response.arrayBuffer());
    } else {
      return null;
    }
    if (!bytes.length) return null;
    return await sharp(bytes)
      .rotate()
      .resize({ width: 511, height: 511, fit: 'inside', withoutEnlargement: true })
      .png()
      .toBuffer();
  } catch (error) {
    console.warn('[Cloudflare Image] Could not prepare reference image:', error);
    return null;
  }
}

function extractImageBase64(payload: any): string {
  return String(payload?.result?.image || payload?.image || payload?.result?.data?.image || '').trim();
}

function imageDataUri(base64: string): string {
  const bytes = Buffer.from(base64, 'base64');
  const mime = bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    ? 'image/png'
    : bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
      ? 'image/jpeg'
      : 'image/png';
  return `data:${mime};base64,${base64}`;
}

async function callCloudflare(
  accountId: string,
  token: string,
  model: string,
  options: ImageGenerationOptions,
  seed: number,
  references: Buffer[],
): Promise<string> {
  const { width, height } = parseResolution(options.resolution);
  const url = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai/run/${model}`;
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };

  let response: Response;
  if (model.includes('/flux-2-')) {
    const form = new FormData();
    form.set('prompt', options.prompt);
    form.set('width', String(width));
    form.set('height', String(height));
    if (seed > 0) form.set('seed', String(seed));
    const guidance = Number(options.providerParams?.cfg || options.providerParams?.guidance || 0);
    if (Number.isFinite(guidance) && guidance > 0) form.set('guidance', String(guidance));
    references.slice(0, 4).forEach((bytes, index) => {
      const view = Uint8Array.from(bytes);
      form.set(`input_image_${index}`, new Blob([view], { type: 'image/png' }), `reference-${index}.png`);
    });
    response = await fetch(url, {
      method: 'POST',
      headers,
      body: form,
      signal: AbortSignal.timeout(180000),
    });
  } else {
    const payload: Record<string, unknown> = { prompt: options.prompt, width, height };
    if (seed > 0) payload.seed = seed;
    const steps = Math.floor(Number(options.providerParams?.steps || 0));
    if (model.includes('flux-1-schnell')) {
      if (steps > 0) payload.steps = Math.max(1, Math.min(8, steps));
    } else {
      if (steps > 0) payload.num_steps = Math.max(1, Math.min(40, steps));
      const guidance = Number(options.providerParams?.cfg || options.providerParams?.guidance || 0);
      if (Number.isFinite(guidance) && guidance > 0) payload.guidance = Math.max(0, Math.min(10, guidance));
      const negative = String(options.providerParams?.negativePrompt || '').trim();
      if (negative) payload.negative_prompt = negative;
    }
    response = await fetch(url, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(180000),
    });
  }

  const data = await response.json().catch(async () => ({ error: await response.text().catch(() => '') }));
  if (!response.ok || data?.success === false) {
    const detail = JSON.stringify(data).slice(0, 700);
    throw new Error(`Cloudflare Workers AI failed (${response.status}): ${detail}`);
  }
  const image = extractImageBase64(data);
  if (!image) throw new Error('Cloudflare Workers AI returned no image');
  return imageDataUri(image);
}

export async function generateImageWithCloudflare(options: ImageGenerationOptions): Promise<ImageGenerationResult> {
  const accountId = credential('CLOUDFLARE_ACCOUNT_ID');
  const token = credential('CLOUDFLARE_API_TOKEN');
  if (!accountId || !token) {
    throw new CloudflareWorkersAIUnavailableError('CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are required');
  }

  const scope = options.providerParams?.scope === 'private' ? 'private' : 'public';
  const model = normalizeModel(options.model || options.providerParams?.model, scope);
  const requestedReferences = Array.isArray(options.providerParams?.referenceImages)
    ? (options.providerParams?.referenceImages as unknown[]).map((value) => String(value || '').trim()).filter(Boolean).slice(0, 4)
    : [];
  const references = (await Promise.all(requestedReferences.map(referenceBytes))).filter((value): value is Buffer => Boolean(value));
  const count = Math.max(1, Math.min(4, Number(options.numImages || 1) || 1));
  const baseSeed = Math.max(0, Math.floor(Number(options.providerParams?.seed || 0) || 0));
  const images: string[] = [];

  for (let index = 0; index < count; index += 1) {
    const seed = baseSeed > 0 ? baseSeed + index : 0;
    images.push(await callCloudflare(accountId, token, model, options, seed, references));
  }

  return {
    image: images[0],
    images,
    imageResourceUrls: images,
    raw: { provider: 'cloudflare', model, count: images.length, referenceCount: references.length, scope },
  };
}
