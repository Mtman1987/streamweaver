import { NextRequest } from 'next/server';
import { z } from 'zod';
import { apiError, apiOk } from '@/lib/api-response';
import { getTenantFromRequest } from '@/lib/tenant-context';
import {
  readPrivateChatSettings,
  toPublicPrivateChatSettings,
  writePrivateChatSettings,
} from '@/lib/private-chat-settings-store';
import { resolveQwenEndpoint } from '@/services/qwen-private-chat';

const settingsPatchSchema = z.object({
  adultMode: z.boolean().optional(),
  qwenBaseUrl: z.string().trim().max(2000).optional(),
  qwenModel: z.string().trim().max(300).optional(),
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

  const current = await readPrivateChatSettings(session.tenantId);
  const patch = parsed.data;
  const nextUrl = patch.qwenBaseUrl === undefined ? current.qwenBaseUrl : patch.qwenBaseUrl;

  if (nextUrl) {
    const target = resolveQwenEndpoint(nextUrl);
    if (!target.ok) {
      return apiError(target.error, { status: 400, code: 'INVALID_QWEN_ENDPOINT' });
    }
  }

  const settings = await writePrivateChatSettings({
    adultMode: patch.adultMode,
    qwenBaseUrl: patch.qwenBaseUrl,
    qwenModel: patch.qwenModel,
  }, session.tenantId);

  return apiOk({ settings: toPublicPrivateChatSettings(settings) });
}
