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
import { getGenMode } from '@/lib/gen-mode-store';
import { readGenerationSettings } from '@/lib/gen-settings-store';
import { getConfiguredAppUrl } from '@/lib/runtime-origin';
import { z } from 'zod';

const imageSchema = z.object({
  prompt: z.string().trim().min(1, 'prompt is required').max(3000),
  model: z.string().trim().min(1).max(200).optional(),
  resolution: z.string().trim().min(3).max(32).optional(),
  numImages: z.coerce.number().int().min(1).max(4).optional().default(1),
  providerParams: z.record(z.unknown()).optional(),
  providerOverride: z.enum(['eden', 'seaart', 'perchance', 'pollinations']).optional(),
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
    const ext = contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : contentType.includes('jpeg') || contentType.includes('jpg') ? 'jpg' : 'png';
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
    const match = String(dataUri).match(/^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/i);
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
    const tenantId = session?.tenantId || parsed.data.tenantId;
    const scope = parsed.data.scope;

    // Resolve effective mode: prefer tenant gen-settings (UI source of truth),
    // fall back to legacy gen-mode.json toggled by !genmode.
    const [settingsMode, legacyMode] = await Promise.all([
      readGenerationSettings(tenantId).then((s) => s.mode).catch(() => undefined),
      getGenMode(tenantId).catch(() => 'eden' as const),
    ]);
    const genMode = parsed.data.providerOverride || settingsMode || legacyMode;
    const generator = genMode === 'seaart'
      ? generateImageWithSeaArt
      : genMode === 'perchance'
        ? generateImageWithPerchance
        : genMode === 'pollinations'
          ? generateImageWithPollinations
          : generateImageWithEdenAI;
    const result = await generator({
      prompt: parsed.data.prompt,
      tenantId,
      model: parsed.data.model,
      resolution: parsed.data.resolution,
      numImages: parsed.data.numImages,
      providerParams: parsed.data.providerParams,
    });

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

    return apiOk({
      image: firstImage,
      images: imageUrls,
      imageResourceUrl: result.imageResourceUrl,
      imageResourceUrls: result.imageResourceUrls,
      persistedImageUrl: persistedImageUrls[0] || null,
      persistedImageUrls,
      provider: genMode,
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
