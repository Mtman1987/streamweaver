import { NextRequest } from 'next/server';
import { apiError, apiOk } from '@/lib/api-response';
import { getTenantFromRequest } from '@/lib/tenant-context';
import { readGenerationSettings, writeGenerationSettings } from '@/lib/gen-settings-store';
import { z } from 'zod';

const schema = z.object({
  mode: z.enum(['eden', 'seaart', 'perchance']).optional(),
  model: z.string().trim().max(200).optional(),
  lora: z.string().trim().max(200).optional(),
  loraStrength: z.coerce.number().min(0).max(2).optional(),
  imageCount: z.coerce.number().int().min(1).max(4).optional(),
  resolution: z.string().trim().max(32).optional(),
  steps: z.coerce.number().int().min(1).max(150).optional(),
  cfg: z.coerce.number().min(1).max(30).optional(),
  seed: z.coerce.number().int().min(0).optional(),
});

export async function GET(request: NextRequest) {
  const session = getTenantFromRequest(request);
  const settings = await readGenerationSettings(session?.tenantId);
  return apiOk(settings);
}

export async function POST(request: NextRequest) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError('Invalid body', { status: 400, code: 'INVALID_BODY', details: parsed.error.flatten() });
  const session = getTenantFromRequest(request);
  const saved = await writeGenerationSettings(parsed.data, session?.tenantId);
  return apiOk(saved);
}
