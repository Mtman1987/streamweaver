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

export async function generateImageWithSeaArt(options: ImageGenerationOptions): Promise<ImageGenerationResult> {
  const token = readUserConfigSync(options.tenantId).SEAART_TOKEN || process.env.SEAART_TOKEN || '';
  if (!token) throw new Error('SEAART_TOKEN not configured');

  const base = process.env.SEAART_API_BASE || 'https://www.seaart.ai/api';
  const createEndpoints = (
    process.env.SEAART_TEXT2IMG_ENDPOINTS
      || process.env.SEAART_TEXT2IMG_ENDPOINT
      || '/task/text2img,/v1/task/text2img,/task/create/text2img,/task/create'
  )
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const taskResultEndpoints = (
    process.env.SEAART_TASK_RESULT_ENDPOINTS
      || process.env.SEAART_TASK_RESULT_ENDPOINT
      || '/task/result,/v1/task/result,/task/status'
  )
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const headers = {
    Cookie: `T=${token}`,
    'Content-Type': 'application/json',
    Origin: 'https://www.seaart.ai',
    Referer: 'https://www.seaart.ai/',
  };

  let taskId = '';
  let createErrorSummary = '';
  let createEndpointUsed = '';
  for (const endpoint of createEndpoints) {
    const create = await fetch(`${base}${endpoint}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ prompt: options.prompt }),
    });
    const createData = await create.json().catch(async () => ({ error: await create.text().catch(() => '') }));
    if (!create.ok) {
      createErrorSummary = `${endpoint} -> ${create.status} ${JSON.stringify(createData).slice(0, 180)}`;
      continue;
    }
    taskId = createData?.taskId || createData?.data?.taskId || createData?.result?.taskId || '';
    if (taskId) {
      createEndpointUsed = endpoint;
      break;
    }
    createErrorSummary = `${endpoint} -> ok but no taskId (${JSON.stringify(createData).slice(0, 180)})`;
  }

  if (!taskId) {
    throw new Error(`SeaArt create failed across endpoints. Last error: ${createErrorSummary || 'unknown'}`);
  }

  console.info(`[SeaArt] create endpoint succeeded: ${createEndpointUsed}`);

  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    let lastStatusError = '';
    for (const statusEndpoint of taskResultEndpoints) {
      const statusRes = await fetch(`${base}${statusEndpoint}?taskId=${encodeURIComponent(taskId)}`, {
        headers: { Cookie: `T=${token}` },
      });
      const statusData = await statusRes.json().catch(async () => ({ error: await statusRes.text().catch(() => '') }));
      if (!statusRes.ok) {
        lastStatusError = `${statusEndpoint} -> ${statusRes.status} ${JSON.stringify(statusData).slice(0, 180)}`;
        continue;
      }
      const status = statusData?.status || statusData?.data?.status || statusData?.result?.status;
      if (status === 'success') {
        const result = extractImageResult(statusData);
        if (!result.image && !result.imageResourceUrl) {
          throw new Error(`SeaArt task succeeded but returned no image: ${JSON.stringify(statusData).slice(0, 500)}`);
        }
        return result;
      }
      if (status === 'failed') throw new Error('SeaArt task failed');
    }
    if (lastStatusError) {
      console.info(`[SeaArt] status probe (pending/fallback): ${lastStatusError}`);
    }
    await new Promise((r) => setTimeout(r, 2500));
  }
  throw new Error('SeaArt task timed out');
}

export async function generateImageWithPerchance(options: ImageGenerationOptions): Promise<ImageGenerationResult> {
  const generator = String(options.providerParams?.generator || process.env.PERCHANCE_GENERATOR || 'ai-text-to-image').trim();
  const count = Number(options.providerParams?.count || 1);
  const endpoint = `https://perchance.org/api/generateList.php?generator=${encodeURIComponent(generator)}&count=${Math.max(1, Math.min(4, count))}&prompt=${encodeURIComponent(options.prompt)}`;

  const response = await fetch(endpoint, { method: 'GET' });
  const data = await response.json().catch(async () => ({ error: await response.text().catch(() => '') }));
  if (!response.ok) {
    throw new Error(`Perchance generation failed: ${response.status} ${JSON.stringify(data).slice(0, 500)}`);
  }

  const first = Array.isArray(data) ? String(data[0] || '').trim() : '';
  const urlMatch = first.match(/https?:\/\/\S+/i);
  const image = urlMatch ? urlMatch[0] : first;
  if (!image) {
    throw new Error(`Perchance returned no usable image output: ${JSON.stringify(data).slice(0, 500)}`);
  }

  return { image, raw: data };
}
