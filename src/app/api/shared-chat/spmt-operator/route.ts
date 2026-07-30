import { NextRequest } from 'next/server';
import { z } from 'zod';

import { apiError, apiOk } from '@/lib/api-response';
import { applySharedChatOperatorAction, SharedChatOperatorActionSchema } from '@/services/shared-chat-operator-actions';
import { readSharedChatOperatorState } from '@/services/shared-chat-operator-state';
import { queueTtsOverlay } from '@/services/tts-overlay-queue';

const RequestSchema = z.union([
  SharedChatOperatorActionSchema,
  z.object({
    action: z.literal('speak'),
    message: z.string().trim().min(1).max(2_000),
  }),
]);

function serviceTenant(request: NextRequest) {
  const expectedKey = String(process.env.SPMT_SYSTEM_KEY || '').trim();
  const providedKey = String(request.headers.get('x-spmt-key') || '').trim();
  const tenantId = String(request.headers.get('x-spmt-tenant-id') || '').trim();
  if (!expectedKey || providedKey !== expectedKey) return { error: 'SPMT service authentication required' };
  if (!tenantId) return { error: 'SPMT tenant required' };
  return { tenantId };
}

function outputUrl(tenantId: string) {
  return `/overlay/shared-chat-featured?tenant=${encodeURIComponent(tenantId)}`;
}

export async function GET(request: NextRequest) {
  const auth = serviceTenant(request);
  if (auth.error) return apiError(auth.error, { status: auth.error.includes('authentication') ? 401 : 400, code: 'UNAUTHORIZED' });
  return apiOk({
    version: 'commlink-operator.v1',
    tenantId: auth.tenantId,
    state: await readSharedChatOperatorState(auth.tenantId!),
    outputs: [{
      id: 'featured-chat',
      label: 'Featured Chat',
      kind: 'obs-browser',
      path: outputUrl(auth.tenantId!),
      readOnly: true,
    }],
    capabilities: {
      pin: true,
      queue: true,
      feature: true,
      tts: true,
      botAi: '/private-chat',
      voice: '/voice-reply',
      translation: '/dashboard',
      avatar: '/dashboard',
    },
  });
}

export async function POST(request: NextRequest) {
  const auth = serviceTenant(request);
  if (auth.error) return apiError(auth.error, { status: auth.error.includes('authentication') ? 401 : 400, code: 'UNAUTHORIZED' });
  const parsed = RequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError('Invalid Commlink operator action', { status: 400, code: 'INVALID_ACTION' });
  try {
    if (parsed.data.action === 'speak') {
      const result = await queueTtsOverlay(parsed.data.message, auth.tenantId);
      if (!result.ok) return apiError(result.error || 'TTS failed', { status: 502, code: 'TTS_FAILED' });
      return apiOk({
        version: 'commlink-operator-receipt.v1',
        action: 'speak',
        status: result.queued ? 'delivered' : 'skipped',
        reason: result.error || null,
        result,
      });
    }
    const state = await applySharedChatOperatorAction(auth.tenantId!, parsed.data);
    return apiOk({
      version: 'commlink-operator-receipt.v1',
      action: parsed.data.action,
      status: 'delivered',
      state,
    });
  } catch (error: any) {
    return apiError(error?.message || 'Operator action failed', {
      status: error?.statusCode || 500,
      code: error?.code || 'OPERATOR_ACTION_FAILED',
    });
  }
}
