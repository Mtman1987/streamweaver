import { NextRequest } from 'next/server';
import { promises as fs } from 'fs';
import { tenantPath } from '@/lib/tenant';
import { randomUUID } from 'crypto';
import { apiError, apiOk } from '@/lib/api-response';
import { getTenantFromRequest } from '@/lib/tenant-context';
import { generateImageWithEdenAI } from '@/services/image-provider';
import { generateImageWithSeaArt } from '@/services/image-provider';
import { generateImageWithPerchance } from '@/services/image-provider';
import { getGenMode } from '@/lib/gen-mode-store';
import { z } from 'zod';

const imageSchema = z.object({
  prompt: z.string().trim().min(1, 'prompt is required').max(3000),
  model: z.string().trim().min(1).max(200).optional(),
  resolution: z.string().trim().min(3).max(32).optional(),
  numImages: z.coerce.number().int().min(1).max(4).optional().default(1),
  providerParams: z.record(z.unknown()).optional(),
  tenantId: z.string().trim().max(128).optional(),
});


async function persistImageFromUrl(imageUrl: string, tenantId?: string): Promise<string | null> {
  try {
    if (!/^https?:\/\//i.test(imageUrl)) return null;
    const res = await fetch(imageUrl);
    if (!res.ok) return null;
    const contentType = String(res.headers.get('content-type') || '').toLowerCase();
    const ext = contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : contentType.includes('jpeg') || contentType.includes('jpg') ? 'jpg' : 'png';
    const bytes = Buffer.from(await res.arrayBuffer());
    const id = randomUUID();
    const relDir = tenantId ? tenantPath(tenantId, 'data/generated-images') : `${process.cwd()}/data/generated-images`;
    await fs.mkdir(relDir, { recursive: true });
    const filename = `${id}.${ext}`;
    await fs.writeFile(`${relDir}/${filename}`, bytes);
    const base = process.env.NEXT_PUBLIC_STREAMWEAVE_URL || process.env.NEXT_PUBLIC_BASE_URL || '';
    const path = `/api/ai/image/file/${filename}${tenantId ? `?tenantId=${encodeURIComponent(tenantId)}` : ''}`;
    return base ? `${base}${path}` : path;
  } catch {
    return null;
  }
}

async function persistImageFromDataUri(dataUri: string, tenantId?: string): Promise<string | null> {
  try {
    const match = String(dataUri).match(/^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/i);
    if (!match) return null;
    const ext = match[1].toLowerCase() === 'jpeg' ? 'jpg' : match[1].toLowerCase();
    const bytes = Buffer.from(match[2], 'base64');
    if (!bytes.length) return null;
    const id = randomUUID();
    const relDir = tenantId ? tenantPath(tenantId, 'data/generated-images') : `${process.cwd()}/data/generated-images`;
    await fs.mkdir(relDir, { recursive: true });
    const filename = `${id}.${ext}`;
    await fs.writeFile(`${relDir}/${filename}`, bytes);
    const base = process.env.NEXT_PUBLIC_STREAMWEAVE_URL || process.env.NEXT_PUBLIC_BASE_URL || '';
    const path = `/api/ai/image/file/${filename}${tenantId ? `?tenantId=${encodeURIComponent(tenantId)}` : ''}`;
    return base ? `${base}${path}` : path;
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

    const genMode = await getGenMode(tenantId);
    const generator = genMode === 'seaart' ? generateImageWithSeaArt : genMode === 'perchance' ? generateImageWithPerchance : generateImageWithEdenAI;
    const result = await generator({
      prompt: parsed.data.prompt,
      tenantId,
      model: parsed.data.model,
      resolution: parsed.data.resolution,
      numImages: parsed.data.numImages,
      providerParams: parsed.data.providerParams,
    });

    // Prefer provider-hosted URL first; some providers return gigantic base64 data URIs in `image`.
    const sourceValue = result.imageResourceUrl || result.image || '';
    const source = String(sourceValue);
    const persistedUrl = source.startsWith('data:image/')
      ? await persistImageFromDataUri(source, tenantId)
      : await persistImageFromUrl(source, tenantId);

    return apiOk({
      image: persistedUrl || result.imageResourceUrl || result.image,
      imageResourceUrl: result.imageResourceUrl,
      persistedImageUrl: persistedUrl || null,
      provider: genMode,
    });
  } catch (error: any) {
    console.error('[AI Image] Error:', error);
    return apiError(error?.message || 'Image generation failed', {
      status: 500,
      code: 'IMAGE_GENERATION_FAILED',
    });
  }
}
