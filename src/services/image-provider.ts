import { readUserConfigSync } from '@/lib/user-config';
import { generateImageWithSeaArtCli, SeaArtCliUnavailableError } from './seaart-cli';

export type ImageGenerationResult = {
  image?: string;
  imageResourceUrl?: string;
  images?: string[];
  imageResourceUrls?: string[];
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

function readResponseBody(response: Response): Promise<unknown> {
  const contentType = String(response.headers.get('content-type') || '').toLowerCase();
  if (contentType.includes('application/json')) {
    return response.json().catch(async () => ({ error: await response.text().catch(() => '') }));
  }
  return response.text().catch(() => '');
}

function summarizeResponseBody(data: unknown): string {
  return (typeof data === 'string' ? data : JSON.stringify(data)).slice(0, 500);
}

function looksLikeCloudflareChallenge(response: Response, data: unknown): boolean {
  const text = typeof data === 'string' ? data : JSON.stringify(data);
  return response.status === 403
    && /just a moment|cloudflare|challenges\.cloudflare\.com/i.test(text);
}

function parseResolution(resolution?: string): { width: number; height: number } {
  const value = String(resolution || '').trim().toLowerCase();
  const explicit = value.match(/^(\d{3,4})\s*x\s*(\d{3,4})$/);
  if (explicit) {
    return {
      width: Math.max(256, Math.min(1536, Number(explicit[1]))),
      height: Math.max(256, Math.min(1536, Number(explicit[2]))),
    };
  }
  if (value === 'landscape') return { width: 1024, height: 768 };
  if (value === 'portrait') return { width: 768, height: 1024 };
  return { width: 1024, height: 1024 };
}

function makePollinationsUrls(options: ImageGenerationOptions): string[] {
  const { width, height } = parseResolution(options.resolution);
  const count = Math.max(1, Math.min(4, Number(options.numImages || options.providerParams?.count || 1) || 1));
  const seed = Math.floor(Number(options.providerParams?.seed || 0) || 0);
  return Array.from({ length: count }, (_, index) => {
    const url = new URL(`https://image.pollinations.ai/prompt/${encodeURIComponent(options.prompt)}`);
    url.searchParams.set('width', String(width));
    url.searchParams.set('height', String(height));
    url.searchParams.set('nologo', 'true');
    if (options.providerParams?.safe !== false) url.searchParams.set('safe', 'true');
    if (seed > 0) url.searchParams.set('seed', String(seed + index));
    return url.toString();
  });
}

const seaArtModels: Record<string, { modelNo: string; modelVerNo: string; hd: boolean }> = {
  'seaart-infinity': {
    modelNo: 'f8172af6747ec762bcf847bd60fdf7cd',
    modelVerNo: '2c39fe1f-f5d6-4b50-a273-499677f2f7a9',
    hd: true,
  },
  'seaart-film': {
    modelNo: '26058e019e3a0c026e1ad2bfa69e2b75',
    modelVerNo: '91b19145-a436-4bbc-ace4-62399e71336b',
    hd: true,
  },
  'seaart-film-edit-3': {
    modelNo: 'd6eqg15e878c73dilcv0',
    modelVerNo: 'a8b3e33e-02b5-4a27-bca8-c331c87b267f',
    hd: true,
  },
  'wai-ani-ponyxl': {
    modelNo: '24231feb2db47b663ff5b3123f01fab6',
    modelVerNo: '6e2e976db9a8e83312a0c91b852f876c',
    hd: false,
  },
};

const seaArtModelAliases: Record<string, string> = {
  infinity: 'seaart-infinity',
  'seaart infinity': 'seaart-infinity',
  'seaart_infinity': 'seaart-infinity',
  film: 'seaart-film',
  realistic: 'seaart-infinity',
  'seaart-realistic': 'seaart-infinity',
  anime: 'wai-ani-ponyxl',
  'seaart-anime': 'wai-ani-ponyxl',
  pony: 'wai-ani-ponyxl',
  ponyxl: 'wai-ani-ponyxl',
  'pony-xl': 'wai-ani-ponyxl',
  'pony xl': 'wai-ani-ponyxl',
  'wai ani ponyxl': 'wai-ani-ponyxl',
  'wai-ani-pony': 'wai-ani-ponyxl',
};

function normalizeSeaArtModelKey(value: unknown): string {
  const raw = String(value || '').trim();
  if (!raw) return 'seaart-infinity';
  const direct = raw.toLowerCase();
  return seaArtModels[raw] ? raw : seaArtModelAliases[direct] || direct;
}

function parseSeaArtModelSpec(value: unknown): { modelNo?: string; modelVerNo?: string } {
  const raw = String(value || '').trim();
  if (!raw) return {};

  if (raw.startsWith('{')) {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      return {
        modelNo: String(parsed.modelNo || parsed.model_no || parsed.model || '').trim() || undefined,
        modelVerNo: String(parsed.modelVerNo || parsed.model_ver_no || parsed.version || parsed.versionNo || '').trim() || undefined,
      };
    } catch {
      // Fall through to separator parsing.
    }
  }

  const separator = raw.includes('::') ? '::' : raw.includes('|') ? '|' : raw.includes(',') ? ',' : raw.includes('@') ? '@' : raw.includes(':') ? ':' : '';
  if (separator) {
    const [modelNo, modelVerNo] = raw.split(separator).map((part) => part.trim()).filter(Boolean);
    return { modelNo, modelVerNo };
  }

  return { modelNo: raw };
}

function hasCompleteSeaArtModelSpec(value: unknown): boolean {
  const raw = String(value || '').trim();
  if (!raw) return false;
  if (raw.startsWith('{')) {
    const parsed = parseSeaArtModelSpec(raw);
    return Boolean(parsed.modelNo && parsed.modelVerNo);
  }
  return raw.includes('::') || raw.includes('|') || raw.includes(',') || raw.includes('@') || raw.includes(':');
}

function getSeaArtModel(options: ImageGenerationOptions): { key: string; modelNo: string; modelVerNo: string; hd: boolean } {
  const configuredModel = options.model || options.providerParams?.model || process.env.SEAART_MODEL || 'seaart-infinity';
  const key = normalizeSeaArtModelKey(configuredModel);
  const preset = seaArtModels[key];
  const custom = !preset && hasCompleteSeaArtModelSpec(configuredModel) ? parseSeaArtModelSpec(configuredModel) : {};
  const fallback = preset || seaArtModels['seaart-infinity'];
  const explicitPairNo = options.providerParams?.modelNo || options.providerParams?.model_no || process.env.SEAART_MODEL_NO || custom.modelNo;
  const explicitPairVerNo = options.providerParams?.modelVerNo || options.providerParams?.model_ver_no || process.env.SEAART_MODEL_VER || custom.modelVerNo;
  if (!preset && !custom.modelNo) {
    console.warn(`[SeaArt] Unknown model "${String(configuredModel || '').trim()}"; using seaart-infinity preset. Use modelNo:modelVerNo for custom SeaArt models.`);
  }
  if (explicitPairNo && !explicitPairVerNo) {
    console.warn('[SeaArt] Ignoring incomplete custom model config; custom SeaArt models require both modelNo and modelVerNo.');
  }
  const hasCompleteExplicitPair = Boolean(explicitPairNo && explicitPairVerNo);
  const modelNo = String(
    (hasCompleteExplicitPair ? explicitPairNo : '') ||
    fallback.modelNo,
  ).trim();
  const modelVerNo = String(
    (hasCompleteExplicitPair ? explicitPairVerNo : '') ||
    fallback.modelVerNo,
  ).trim();
  return { key: preset ? key : hasCompleteExplicitPair ? String(configuredModel || 'custom-seaart-model').trim() : 'seaart-infinity', modelNo, modelVerNo, hd: fallback.hd };
}

export function isSeaArtModelMismatchError(error: unknown): boolean {
  return /model version mismatch|model[_\s-]*ver(?:sion)? .* mismatch/i.test(
    error instanceof Error ? error.message : String(error || ''),
  );
}

function normalizeSeaArtDimensions(resolution: string | undefined, hd: boolean): { width: number; height: number } {
  let { width, height } = parseResolution(resolution);
  if (hd && width * height < 3686400) {
    const scale = Math.sqrt(3686400 / (width * height));
    width = Math.ceil((width * scale) / 64) * 64;
    height = Math.ceil((height * scale) / 64) * 64;
  }
  return { width, height };
}

function getEdenAIKey(tenantId?: string): string {
  const config = readUserConfigSync(tenantId);
  return config.EDENAI_API_KEY || process.env.EDENAI_API_KEY || '';
}

export const DEFAULT_EDEN_IMAGE_MODEL = 'image/generation/leonardo/SDXL 0.9';
const EDEN_IMAGE_MODEL_FALLBACK = 'image/generation/bytedance';

export function normalizeEdenImageModel(model?: string): string {
  const value = String(model || '').trim();
  if (
    !value ||
    /^image\/generation\/leonardo\/leonardo phoenix$/i.test(value) ||
    /^image\/generation\/bytedance\/seedream-3-0-t2i-250415$/i.test(value)
  ) {
    return DEFAULT_EDEN_IMAGE_MODEL;
  }
  return value;
}

function getDefaultImageModel(tenantId?: string): string {
  const config = readUserConfigSync(tenantId);
  return normalizeEdenImageModel(
    config.EDENAI_IMAGE_MODEL ||
    process.env.EDENAI_IMAGE_MODEL ||
    DEFAULT_EDEN_IMAGE_MODEL
  );
}

function extractImageResult(data: any): ImageGenerationResult {
  const item = data?.output?.items?.[0] || data?.items?.[0] || data?.output?.[0] || data?.[0];
  const items = data?.output?.items || data?.items || data?.output || data;
  const list = Array.isArray(items) ? items : [];
  const images = list.map((entry: any) => entry?.image || entry?.image_resource_url || entry?.imageResourceUrl || entry).filter(Boolean);
  return {
    image: item?.image || data?.output?.image || data?.image,
    imageResourceUrl: item?.image_resource_url || item?.imageResourceUrl || data?.output?.image_resource_url || data?.image_resource_url,
    images,
    imageResourceUrls: images,
    raw: data,
  };
}

export function buildEdenAIImagePayload(options: ImageGenerationOptions, defaultModel: string) {
  return {
    model: normalizeEdenImageModel(options.model || defaultModel),
    input: {
      text: options.prompt,
      ...(options.resolution ? { resolution: options.resolution } : {}),
      ...(options.numImages ? { num_images: options.numImages } : {}),
    },
  };
}

export async function generateImageWithEdenAI(options: ImageGenerationOptions): Promise<ImageGenerationResult> {
  const apiKey = getEdenAIKey(options.tenantId);
  if (!apiKey) {
    throw new Error('No EdenAI API key configured for image generation');
  }

  // providerParams contains SeaArt-specific controls such as cfg, steps, seed,
  // and LoRA settings. Eden forwards unknown provider variables to Leonardo,
  // where they make the entire generation fail instead of being ignored.
  const requestedModel = normalizeEdenImageModel(options.model || getDefaultImageModel(options.tenantId));
  const models = [requestedModel, DEFAULT_EDEN_IMAGE_MODEL, EDEN_IMAGE_MODEL_FALLBACK]
    .filter((model, index, all) => all.indexOf(model) === index);
  let lastFailure = '';

  for (const model of models) {
    const payload = buildEdenAIImagePayload({ ...options, model }, DEFAULT_EDEN_IMAGE_MODEL);
    const response = await fetch('https://api.edenai.run/v3/universal-ai', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json().catch(async () => ({ error: await response.text().catch(() => '') }));
    const result = extractImageResult(data);
    if (response.ok && (result.image || result.imageResourceUrl)) {
      if (model !== requestedModel) {
        console.warn(`[AI Image] EdenAI model unavailable; generated with fallback model=${model}`);
      }
      return result;
    }

    lastFailure = `${response.status} ${JSON.stringify(data).slice(0, 500)}`;
    const providerStatus = Number(data?.error?.provider_status_code || 0);
    const errorMessage = String(data?.error?.message || data?.error || '');
    const modelUnavailable = response.status === 404 ||
      providerStatus === 404 ||
      /model or endpoint .* does not exist|do not have access/i.test(errorMessage);
    if (!modelUnavailable) {
      const failureKind = response.ok ? 'returned no image' : 'failed';
      throw new Error(`EdenAI image generation ${failureKind}: ${lastFailure}`);
    }
  }

  throw new Error(`EdenAI image generation failed after model fallback: ${lastFailure}`);
}

export async function generateImageWithSeaArt(options: ImageGenerationOptions): Promise<ImageGenerationResult> {
  const token = readUserConfigSync(options.tenantId).SEAART_TOKEN || process.env.SEAART_TOKEN || '';
  if (!token) throw new Error('SEAART_TOKEN not configured');

  const base = process.env.SEAART_API_BASE || 'https://www.seaart.ai';
  const createEndpoint = process.env.SEAART_TEXT2IMG_ENDPOINT || '/api/v1/task/v2/text-to-img';
  const progressEndpoint = process.env.SEAART_TASK_RESULT_ENDPOINT || '/api/v1/task/batch-progress';
  let { key: modelKey, modelNo, modelVerNo, hd } = getSeaArtModel(options);
  if (process.env.SEAART_CLI_DISABLED !== 'true') {
    try {
      const result = await generateImageWithSeaArtCli(options, { modelNo, modelVerNo });
      console.info(`[SeaArt] official CLI generation succeeded: model=${modelKey}`);
      return result;
    } catch (error) {
      if (isSeaArtModelMismatchError(error)) {
        const fallback = seaArtModels['seaart-infinity'];
        if (modelKey !== 'seaart-infinity') {
          console.warn(`[SeaArt] CLI rejected stale model=${modelKey}; retrying with seaart-infinity.`);
          try {
            const result = await generateImageWithSeaArtCli(options, {
              modelNo: fallback.modelNo,
              modelVerNo: fallback.modelVerNo,
            });
            console.info('[SeaArt] official CLI fallback generation succeeded: model=seaart-infinity');
            return result;
          } catch (fallbackError) {
            if (!isSeaArtModelMismatchError(fallbackError) && !(fallbackError instanceof SeaArtCliUnavailableError)) {
              throw fallbackError;
            }
            console.warn(`[SeaArt] CLI fallback could not use the preset; trying the provider adapter: ${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}`);
          }
        } else {
          console.warn('[SeaArt] CLI rejected the seaart-infinity version; trying the provider adapter.');
        }
        modelKey = 'seaart-infinity';
        modelNo = fallback.modelNo;
        modelVerNo = fallback.modelVerNo;
        hd = fallback.hd;
      } else {
        if (!(error instanceof SeaArtCliUnavailableError)) throw error;
        console.warn(`[SeaArt] official CLI unavailable; using existing provider adapter: ${error.message}`);
      }
    }
  }
  const { width, height } = normalizeSeaArtDimensions(options.resolution, hd);
  const nIter = Math.max(1, Math.min(8, Number(options.numImages || options.providerParams?.n_iter || 1) || 1));
  const steps = Number(options.providerParams?.steps || 0);
  const cfg = Number(options.providerParams?.cfg || 7);
  const negativePrompt = String(options.providerParams?.negativePrompt || options.providerParams?.negative_prompt || '');

  const headers: Record<string, string> = {
    Cookie: `T=${token}`,
    Accept: 'application/json, text/plain, */*',
    'Content-Type': 'application/json',
    Origin: 'https://www.seaart.ai',
    Referer: 'https://www.seaart.ai/create/image',
    'User-Agent': 'Mozilla/5.0 StreamWeaver SeaArt image-provider',
    'x-app-id': 'web_global_seaart',
    'x-platform': 'web',
    'x-project-id': 'seaart',
  };

  const meta: Record<string, unknown> = {
    prompt: options.prompt,
    network_remix_local_prompt: options.prompt,
    cfa_scale: cfg,
    clip_skip: 2,
    embeddings: [],
    generate: {
      anime_enhance: 0,
      mode: 0,
      gen_mode: 1,
      prompt_magic_mode: 2,
    },
    height,
    width,
    lab_base: { conds: [] },
    lora_models: [],
    n_iter: nIter,
    negative_prompt: negativePrompt,
    restore_faces: false,
    sampler_name: 'DPM++ 2M Karras',
    vae: 'None',
  };
  if (steps > 0) meta.steps = steps;

  async function createSeaArtTask(attempt: { key: string; modelNo: string; modelVerNo: string }) {
    console.info(`[SeaArt] create endpoint request: ${createEndpoint} model=${attempt.key} model_no=${attempt.modelNo} model_ver_no=${attempt.modelVerNo}`);
    const response = await fetch(`${base}${createEndpoint}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model_no: attempt.modelNo,
        model_ver_no: attempt.modelVerNo,
        meta,
        speed_type: 2,
      }),
    });
    const data = await response.json().catch(async () => ({ error: await response.text().catch(() => '') }));
    return { response, data, status: data?.status?.code || data?.code };
  }

  let createAttempt = await createSeaArtTask({ key: modelKey, modelNo, modelVerNo });
  if (!createAttempt.response.ok) {
    throw new Error(`SeaArt create failed: ${createAttempt.response.status} ${JSON.stringify(createAttempt.data).slice(0, 500)}`);
  }
  let createStatus = createAttempt.status;
  if (createStatus !== 10000 && createStatus === 10100 && modelKey !== 'seaart-infinity') {
    const fallback = seaArtModels['seaart-infinity'];
    console.warn(`[SeaArt] model=${modelKey} returned params error; retrying with seaart-infinity preset.`);
    createAttempt = await createSeaArtTask({
      key: 'seaart-infinity',
      modelNo: fallback.modelNo,
      modelVerNo: fallback.modelVerNo,
    });
    if (!createAttempt.response.ok) {
      throw new Error(`SeaArt create failed: ${createAttempt.response.status} ${JSON.stringify(createAttempt.data).slice(0, 500)}`);
    }
    createStatus = createAttempt.status;
  }
  const createData = createAttempt.data;
  if (createStatus !== 10000) {
    throw new Error(`SeaArt create failed: ${createStatus || 'unknown'} ${createData?.status?.msg || JSON.stringify(createData).slice(0, 500)}`);
  }

  const taskId = createData?.data?.id || createData?.taskId || createData?.data?.taskId || '';
  if (!taskId) {
    throw new Error(`SeaArt create returned no task id: ${JSON.stringify(createData).slice(0, 500)}`);
  }

  console.info(`[SeaArt] create endpoint succeeded: ${createEndpoint} model=${modelKey} model_no=${modelNo} model_ver_no=${modelVerNo}`);

  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    const statusRes = await fetch(`${base}${progressEndpoint}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ task_ids: [taskId] }),
    });
    const statusData = await statusRes.json().catch(async () => ({ error: await statusRes.text().catch(() => '') }));
    if (!statusRes.ok) {
      console.info(`[SeaArt] status probe: ${statusRes.status} ${JSON.stringify(statusData).slice(0, 180)}`);
      await new Promise((r) => setTimeout(r, 5000));
      continue;
    }
    const task = (statusData?.data?.items || []).find((item: any) => item?.task_id === taskId) || statusData?.data?.items?.[0];
    if (task?.status === 3) {
      const imgUris = Array.isArray(task?.img_uris) ? task.img_uris : [];
      const urls = imgUris
        .map((item: any) => typeof item === 'string' ? item : item?.url)
        .filter(Boolean)
        .map((value: string) => /^https?:\/\//i.test(value) ? value : `https://image.cdn2.seaart.me/${value}`);
      const first = urls[0];
      if (!first) {
        throw new Error(`SeaArt task succeeded but returned no image: ${JSON.stringify(task).slice(0, 500)}`);
      }
      return { imageResourceUrl: first, imageResourceUrls: urls, raw: statusData };
    }
    if (task?.status === 4 || task?.status === 5) {
      throw new Error(`SeaArt task failed: ${task?.fail_reason || JSON.stringify(task).slice(0, 300)}`);
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw new Error('SeaArt task timed out');
}

export async function generateImageWithPollinations(options: ImageGenerationOptions): Promise<ImageGenerationResult> {
  const imageResourceUrls = makePollinationsUrls(options);
  return {
    imageResourceUrl: imageResourceUrls[0],
    imageResourceUrls,
    raw: {
      provider: 'pollinations',
      count: imageResourceUrls.length,
    },
  };
}

export async function generateImageWithPerchance(options: ImageGenerationOptions): Promise<ImageGenerationResult> {
  const generator = String(options.providerParams?.generator || process.env.PERCHANCE_GENERATOR || 'ai-text-to-image').trim();
  const count = Number(options.numImages || options.providerParams?.count || 1);
  const cappedCount = Math.max(1, Math.min(4, count));
  const endpointTemplate = String(process.env.PERCHANCE_ENDPOINT_TEMPLATE || '').trim();
  const endpoint = endpointTemplate
    ? endpointTemplate
        .replaceAll('{generator}', encodeURIComponent(generator))
        .replaceAll('{count}', encodeURIComponent(String(cappedCount)))
        .replaceAll('{prompt}', encodeURIComponent(options.prompt))
    : `https://perchance.org/api/generateList.php?generator=${encodeURIComponent(generator)}&count=${cappedCount}&prompt=${encodeURIComponent(options.prompt)}`;

  const response = await fetch(endpoint, {
    method: 'GET',
    headers: {
      Accept: 'application/json,text/plain;q=0.9,*/*;q=0.8',
      'User-Agent': 'StreamWeaver/0.2 image-provider',
    },
  });
  const data = await readResponseBody(response);
  if (response.ok) {
    const outputs = (Array.isArray(data) ? data : [])
      .flatMap((item: unknown) => {
        const value = String(item || '').trim();
        const matches = value.match(/https?:\/\/[^\s"']+/gi);
        return matches?.length ? matches : (value ? [value] : []);
      })
      .filter(Boolean)
      .slice(0, cappedCount);
    if (outputs.length) {
      return { image: outputs[0], imageResourceUrl: outputs[0], imageResourceUrls: outputs, raw: data };
    }

    throw new Error(`Perchance returned no usable image output: ${JSON.stringify(data).slice(0, 500)}`);
  }

  if (!looksLikeCloudflareChallenge(response, data) && process.env.PERCHANCE_FALLBACK_DISABLED === 'true') {
    throw new Error(`Perchance generation failed: ${response.status} ${summarizeResponseBody(data)}`);
  }

  if (!looksLikeCloudflareChallenge(response, data) && endpointTemplate) {
    throw new Error(`Perchance generation failed: ${response.status} ${summarizeResponseBody(data)}`);
  }

  const fallbackUrls = makePollinationsUrls(options);

  console.warn(`[Perchance] ${response.status} from perchance.org; using Pollinations fallback for image generation.`);
  return {
    imageResourceUrl: fallbackUrls[0],
    imageResourceUrls: fallbackUrls,
    raw: {
      provider: 'perchance',
      fallbackProvider: 'pollinations',
      reason: looksLikeCloudflareChallenge(response, data) ? 'PERCHANCE_CLOUDFLARE_CHALLENGE' : 'PERCHANCE_HTTP_ERROR',
      status: response.status,
    },
  };
}
