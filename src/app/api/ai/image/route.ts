import { NextRequest } from 'next/server';
import { promises as fs } from 'fs';
import { tenantPath } from '@/lib/tenant';
import { randomUUID } from 'crypto';
import { apiError, apiOk } from '@/lib/api-response';
import { getTenantFromRequest } from '@/lib/tenant-context';
import { generateImageWithEdenAI } from '@/services/image-provider';
import { generateImageWithSeaArt } from '@/services/image-provider';
import { generateImageWithPerchance } from '@/services/image-provider';
import { generateImageWithPollinations } from '@/services/image-provider';
import { isSeaArtModelMismatchError } from '@/services/image-provider';
import { CloudflareWorkersAIUnavailableError, generateImageWithCloudflare } from '@/services/cloudflare-image';
import { getGenMode } from '@/lib/gen-mode-store';
import { readGenerationSettings } from '@/lib/gen-settings-store';
import { readPrivateChatSettings } from '@/lib/private-chat-settings-store';
import { getConfiguredAppUrl } from '@/lib/runtime-origin';
import { publishSpmtEvent } from '@/lib/spmt-client';
import { hasInternalServiceAccess, hasMountainViewBridgeAccess } from '@/lib/internal-service-auth';
import { z } from 'zod';

const imageSchema = z.object({
  prompt: z.string().trim().min(1, 'prompt is required').max(3000),
  model: z.string().trim().min(1).max(200).optional(),
  resolution: z.string().trim().min(3).max(32).optional(),
  numImages: z.coerce.number().int().min(1).max(4).optional(),
  providerParams: z.record(z.unknown()).optional(),
  providerOverride: z.enum(['cloudflare', 'eden', 'seaart', 'perchance', 'pollinations']).optional(),
  scope: z.enum(['public', 'private']).optional().default('public'),
  tenantId: z.string().trim().max(128).optional(),
});

type ImageLibraryScope = z.infer<typeof imageSchema>['scope'];

function getImageStoragePath(scope: ImageLibraryScope): string {
  return scope === 'private' ? 'data/private-generated-images' : 'data/generated-images';
}

function buildImageFileUrl(filename: string, scope: ImageLibraryScope, tenantId?: string, request?: NextRequest): string {
  const base = getConfiguredAppUrl(request?.nextUrl.origin);
  const params = new URLSearchParams();
  if (tenantId) params.set('tenantId', tenantId);
  if (scope === 'private') params.set('scope', scope);
  const query = params.toString();
  const path = `/api/ai/image/file/${filename}${query ? `?${query}` : ''}`;
  return base ? `${base}${path}` : path;
}

async function persistImageFromUrl(imageUrl: string, tenantId: string | undefined, scope: ImageLibraryScope, request?: NextRequest): Promise<string | null> {
  try {
    if (!/^https?:\/\//i.test(imageUrl)) return null;
    const res = await fetch(imageUrl);
    if (!res.ok) return null;
    const contentType = String(res.headers.get('content-type') || '').toLowerCase();
    const ext = contentType.includes('gif')
      ? 'gif'
      : contentType.includes('png')
        ? 'png'
        : contentType.includes('webp')
          ? 'webp'
          : contentType.includes('jpeg') || contentType.includes('jpg')
            ? 'jpg'
            : 'png';
    const bytes = Buffer.from(await res.arrayBuffer());
    const id = randomUUID();
    const storagePath = getImageStoragePath(scope);
    const relDir = tenantId ? tenantPath(tenantId, storagePath) : `${process.cwd()}/${storagePath}`;
    await fs.mkdir(relDir, { recursive: true });
    const filename = `${id}.${ext}`;
    await fs.writeFile(`${relDir}/${filename}`, bytes);
    return buildImageFileUrl(filename, scope, tenantId, request);
  } catch {
    return null;
  }
}

async function persistImageFromDataUri(dataUri: string, tenantId: string | undefined, scope: ImageLibraryScope, request?: NextRequest): Promise<string | null> {
  try {
    const match = String(dataUri).match(/^data:image\/(gif|png|jpeg|jpg|webp)(?:;charset=[^;]+)?;base64,(.+)$/i);
    if (!match) return null;
    const ext = match[1].toLowerCase() === 'jpeg' ? 'jpg' : match[1].toLowerCase();
    const bytes = Buffer.from(match[2], 'base64');
    if (!bytes.length) return null;
    const id = randomUUID();
    const storagePath = getImageStoragePath(scope);
    const relDir = tenantId ? tenantPath(tenantId, storagePath) : `${process.cwd()}/${storagePath}`;
    await fs.mkdir(relDir, { recursive: true });
    const filename = `${id}.${ext}`;
    await fs.writeFile(`${relDir}/${filename}`, bytes);
    return buildImageFileUrl(filename, scope, tenantId, request);
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  try {
    const parsed = imageSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return apiError('Invalid image generation request', {
        status: 400,
        code: 'INVALID_BODY',
        details: parsed.error.flatten(),
      });
    }

    const session = getTenantFromRequest(request);
    const hasServiceAccess = hasInternalServiceAccess(request);
    const hasMountainViewAccess = hasMountainViewBridgeAccess(request);
    if (!session?.tenantId && !hasServiceAccess && !hasMountainViewAccess) {
      return apiError('Unauthorized', { status: 401, code: 'UNAUTHORIZED' });
    }
    const tenantId = session?.tenantId || ((hasServiceAccess || hasMountainViewAccess) ? parsed.data.tenantId : undefined);
    if (!tenantId) {
      return apiError('Tenant context required', { status: 400, code: 'TENANT_REQUIRED' });
    }
    const scope = parsed.data.scope;

    const [settings, legacyMode, privateSettings] = await Promise.all([
      readGenerationSettings(tenantId).catch(() => undefined),
      getGenMode(tenantId).catch(() => 'cloudflare' as const),
      scope === 'private' ? readPrivateChatSettings(tenantId).catch(() => undefined) : Promise.resolve(undefined),
    ]);
    const genMode = parsed.data.providerOverride || settings?.mode || legacyMode;
    const generator = genMode === 'cloudflare'
      ? generateImageWithCloudflare
      : genMode === 'seaart'
        ? generateImageWithSeaArt
        : genMode === 'perchance'
          ? generateImageWithPerchance
          : genMode === 'pollinations'
            ? generateImageWithPollinations
            : generateImageWithEdenAI;
    const generationOptions = {
      prompt: parsed.data.prompt,
      tenantId,
      model: parsed.data.model || settings?.model || undefined,
      resolution: parsed.data.resolution || settings?.resolution || undefined,
      numImages: parsed.data.numImages || settings?.imageCount || 1,
      providerParams: {
        lora: settings?.lora || undefined,
        loraStrength: settings?.lora ? settings?.loraStrength : undefined,
        steps: settings?.steps,
        cfg: settings?.cfg,
        seed: settings?.seed,
        scope,
        adultMode: scope === 'private' && privateSettings?.adultMode === true,
        ...(parsed.data.providerParams || {}),
      },
    };
    let effectiveGenMode = genMode;
    let result;
    try {
      result = await generator(generationOptions);
    } catch (error) {
      if (genMode === 'cloudflare' && error instanceof CloudflareWorkersAIUnavailableError) {
        console.warn('[AI Image] Cloudflare credentials are not configured; falling back to Pollinations until they are added.');
        result = await generateImageWithPollinations(generationOptions);
        effectiveGenMode = 'pollinations';
      } else if (genMode === 'seaart' && isSeaArtModelMismatchError(error)) {
        console.warn('[AI Image] SeaArt rejected the saved model version after preset fallback; generating with EdenAI.');
        result = await generateImageWithEdenAI({
          ...generationOptions,
          model: undefined,
          providerParams: undefined,
        });
        effectiveGenMode = 'eden';
      } else {
        throw error;
      }
    }

    const sources = [
      ...(Array.isArray(result.imageResourceUrls) ? result.imageResourceUrls : []),
      ...(Array.isArray(result.images) ? result.images : []),
      result.imageResourceUrl,
      result.image,
    ]
      .map((value) => String(value || '').trim())
      .filter(Boolean)
      .filter((value, index, all) => all.indexOf(value) === index);

    const persistedImageUrls: string[] = [];
    for (const source of sources) {
      const persisted = source.startsWith('data:image/')
        ? await persistImageFromDataUri(source, tenantId, scope, request)
        : await persistImageFromUrl(source, tenantId, scope, request);
      if (persisted) persistedImageUrls.push(persisted);
    }

    const imageUrls = persistedImageUrls.length ? persistedImageUrls : sources;
    const firstImage = imageUrls[0] || result.imageResourceUrl || result.image || '';
    void publishSpmtEvent({
      type: 'image.generation.completed',
      visibility: scope === 'private' ? 'private' : 'creator',
      actor: tenantId ? { userId: tenantId, username: tenantId, displayName: tenantId } : undefined,
      payload: {
        summary: `Generated ${imageUrls.length || 0} image${imageUrls.length === 1 ? '' : 's'} with ${effectiveGenMode}.`,
        tenantId: tenantId || 'global',
        prompt: parsed.data.prompt,
        provider: effectiveGenMode,
        model: parsed.data.model || settings?.model || null,
        resolution: parsed.data.resolution || settings?.resolution || null,
        imageCount: imageUrls.length,
        persistedImageCount: persistedImageUrls.length,
        scope,
        adultMode: scope === 'private' && privateSettings?.adultMode === true,
      },
      links: firstImage && /^https?:\/\//i.test(firstImage)
        ? [{ label: 'Open image', url: firstImage, kind: 'details' }]
        : undefined,
    });

    return apiOk({
      image: firstImage,
      images: imageUrls,
      imageResourceUrl: result.imageResourceUrl,
      imageResourceUrls: result.imageResourceUrls,
      persistedImageUrl: persistedImageUrls[0] || null,
      persistedImageUrls,
      provider: effectiveGenMode,
      scope,
    });
  } catch (error: any) {
    console.error('[AI Image] Error:', error);
    return apiError(error?.message || 'Image generation failed', {
      status: 500,
      code: 'IMAGE_GENERATION_FAILED',
    });
  }
}
