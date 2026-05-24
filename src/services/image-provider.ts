import { readUserConfigSync } from '@/lib/user-config';

export type ImageGenerationResult = {
  image?: string;
  imageResourceUrl?: string;
  raw: unknown;
};

export type ImageGenerationOptions = {
  prompt: string;
  tenantId?: string;
  model?: string;
  resolution?: string;
  numImages?: number;
  providerParams?: Record<string, unknown>;
};

function getEdenAIKey(tenantId?: string): string {
  const config = readUserConfigSync(tenantId);
  return config.EDENAI_API_KEY || process.env.EDENAI_API_KEY || '';
}

function getDefaultImageModel(tenantId?: string): string {
  const config = readUserConfigSync(tenantId);
  return (
    config.EDENAI_IMAGE_MODEL ||
    process.env.EDENAI_IMAGE_MODEL ||
    'image/generation/leonardo/Leonardo Phoenix'
  );
}

function extractImageResult(data: any): ImageGenerationResult {
  const item = data?.output?.items?.[0] || data?.items?.[0] || data?.output?.[0] || data?.[0];
  return {
    image: item?.image || data?.output?.image || data?.image,
    imageResourceUrl: item?.image_resource_url || item?.imageResourceUrl || data?.output?.image_resource_url || data?.image_resource_url,
    raw: data,
  };
}

export async function generateImageWithEdenAI(options: ImageGenerationOptions): Promise<ImageGenerationResult> {
  const apiKey = getEdenAIKey(options.tenantId);
  if (!apiKey) {
    throw new Error('No EdenAI API key configured for image generation');
  }

  const payload = {
    model: options.model || getDefaultImageModel(options.tenantId),
    input: {
      text: options.prompt,
      ...(options.resolution ? { resolution: options.resolution } : {}),
      ...(options.numImages ? { num_images: options.numImages } : {}),
    },
    ...(options.providerParams ? { provider_params: options.providerParams } : {}),
  };

  const response = await fetch('https://api.edenai.run/v3/universal-ai', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json().catch(async () => ({ error: await response.text().catch(() => '') }));
  if (!response.ok) {
    throw new Error(`EdenAI image generation failed: ${response.status} ${JSON.stringify(data).slice(0, 500)}`);
  }

  const result = extractImageResult(data);
  if (!result.image && !result.imageResourceUrl) {
    throw new Error(`EdenAI image generation returned no image: ${JSON.stringify(data).slice(0, 500)}`);
  }

  return result;
}
