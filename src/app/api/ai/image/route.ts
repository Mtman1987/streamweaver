import { NextRequest } from 'next/server';
import { promises as fs } from 'fs';
import { tenantPath } from '@/lib/tenant';
import { randomUUID } from 'crypto';
import { apiError, apiOk } from '@/lib/api-response';
import { getTenantFromRequest } from '@/lib/tenant-context';
import { generateImageWithEdenAI } from '@/services/image-provider';
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

    const result = await generateImageWithEdenAI({
      prompt: parsed.data.prompt,
      tenantId,
      model: parsed.data.model,
      resolution: parsed.data.resolution,
      numImages: parsed.data.numImages,
      providerParams: parsed.data.providerParams,
    });

    const upstreamUrl = result.image || result.imageResourceUrl || '';
    const persistedUrl = await persistImageFromUrl(String(upstreamUrl), tenantId);

    return apiOk({
      image: persistedUrl || result.image,
      imageResourceUrl: result.imageResourceUrl,
      persistedImageUrl: persistedUrl || null,
    });
  } catch (error: any) {
    console.error('[AI Image] Error:', error);
    return apiError(error?.message || 'Image generation failed', {
      status: 500,
      code: 'IMAGE_GENERATION_FAILED',
    });
  }
}
