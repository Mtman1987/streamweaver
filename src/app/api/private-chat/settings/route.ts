import { NextRequest } from 'next/server';
import { z } from 'zod';
import { apiError, apiOk } from '@/lib/api-response';
import { getTenantFromRequest } from '@/lib/tenant-context';
import {
  getEffectiveQwenBaseUrl,
  getEffectiveQwenModel,
  readPrivateChatSettings,
  toPublicPrivateChatSettings,
  writePrivateChatSettings,
  type PrivateChatSettings,
} from '@/lib/private-chat-settings-store';
import { resolveQwenEndpoint } from '@/services/qwen-private-chat';
import {
  DEFAULT_BUILT_IN_QWEN_MODEL,
  discoverAvailableBuiltInQwenModels,
  selectPreferredBuiltInQwenModel,
} from '@/services/qwen-quality';

const settingsPatchSchema = z.object({
  adultMode: z.boolean().optional(),
  qwenBaseUrl: z.string().trim().max(2000).optional(),
  qwenModel: z.string().trim().max(300).optional(),
});

export const dynamic = 'force-dynamic';

async function buildSettingsPayload(settings: PrivateChatSettings) {
  const qwenBaseUrl = getEffectiveQwenBaseUrl(settings);
  const configuredQwenModel = getEffectiveQwenModel(settings);
  const availableQwenModels = await discoverAvailableBuiltInQwenModels({
    baseUrl: qwenBaseUrl,
    apiKey: process.env.PRIVATE_QWEN_API_KEY,
  });
  const effectiveQwenModel = selectPreferredBuiltInQwenModel(
    configuredQwenModel,
    availableQwenModels,
  );

  return {
    ...toPublicPrivateChatSettings(settings),
    configuredQwenModel,
    effectiveQwenModel,
    availableQwenModels,
    qwenAutoSelectEnabled: configuredQwenModel === DEFAULT_BUILT_IN_QWEN_MODEL,
    qwenModelDiscoveryAvailable: availableQwenModels.length > 0,
  };
}

export async function GET(request: NextRequest) {
  const session = getTenantFromRequest(request);
  if (!session?.tenantId) {
    return apiError('Unauthorized', { status: 401, code: 'UNAUTHORIZED' });
  }

  const settings = await readPrivateChatSettings(session.tenantId);
  return apiOk({ settings: await buildSettingsPayload(settings) });
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

  return apiOk({ settings: await buildSettingsPayload(settings) });
}
