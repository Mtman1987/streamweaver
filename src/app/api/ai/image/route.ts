import { NextRequest } from 'next/server';
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

    return apiOk({
      image: result.image,
      imageResourceUrl: result.imageResourceUrl,
    });
  } catch (error: any) {
    console.error('[AI Image] Error:', error);
    return apiError(error?.message || 'Image generation failed', {
      status: 500,
      code: 'IMAGE_GENERATION_FAILED',
    });
  }
}
