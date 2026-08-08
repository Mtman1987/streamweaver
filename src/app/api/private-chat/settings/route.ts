import { NextRequest } from 'next/server';
import { z } from 'zod';
import { apiError, apiOk } from '@/lib/api-response';
import { getTenantFromRequest } from '@/lib/tenant-context';
import {
  readPrivateChatSettings,
  toPublicPrivateChatSettings,
  writePrivateChatSettings,
} from '@/lib/private-chat-settings-store';

const settingsPatchSchema = z.object({
  adultMode: z.boolean().optional(),
});

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const session = getTenantFromRequest(request);
  if (!session?.tenantId) {
    return apiError('Unauthorized', { status: 401, code: 'UNAUTHORIZED' });
  }

  const settings = await readPrivateChatSettings(session.tenantId);
  return apiOk({ settings: toPublicPrivateChatSettings(settings) });
}

export async function POST(request: NextRequest) {
  const session = getTenantFromRequest(request);
  if (!session?.tenantId) {
    return apiError('Unauthorized', { status: 401, code: 'UNAUTHORIZED' });
  }

  const parsed = settingsPatchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return apiError('Invalid private-chat settings', {
      status: 400,
      code: 'INVALID_BODY',
      details: parsed.error.flatten(),
    });
  }

  const settings = await writePrivateChatSettings({
    adultMode: parsed.data.adultMode,
  }, session.tenantId);

  return apiOk({ settings: toPublicPrivateChatSettings(settings) });
}
