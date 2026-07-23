import { NextRequest } from 'next/server';
import { z } from 'zod';
import { apiError, apiOk } from '@/lib/api-response';
import { getTenantFromRequest } from '@/lib/tenant-context';
import {
  getActiveTtsConsumer,
  touchTtsConsumer,
  type TtsConsumerKind,
  type TtsConsumerScope,
} from '@/services/tts-consumer-presence';

const presenceSchema = z.object({
  tenantId: z.string().trim().max(128).optional(),
  kind: z.enum(['overlay', 'listener', 'dashboard', 'say', 'mixer', 'other']).default('other'),
  scope: z.enum(['overlay', 'say']).optional(),
});

function requestTenantId(request: NextRequest, bodyTenantId?: string): string {
  return getTenantFromRequest(request)?.tenantId
    || bodyTenantId
    || request.nextUrl.searchParams.get('tenant')
    || request.nextUrl.searchParams.get('tenantId')
    || '';
}

export async function POST(request: NextRequest) {
  const parsed = presenceSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return apiError('Invalid TTS presence heartbeat', { status: 400, code: 'INVALID_BODY' });
  }

  const tenantId = requestTenantId(request, parsed.data.tenantId);
  const kind = parsed.data.kind as TtsConsumerKind;
  const scope = parsed.data.scope as TtsConsumerScope | undefined;
  if (!tenantId || !touchTtsConsumer(tenantId, kind, scope)) {
    return apiError('Tenant context required', { status: 400, code: 'TENANT_REQUIRED' });
  }

  return apiOk({ active: true });
}

export async function GET(request: NextRequest) {
  const tenantId = requestTenantId(request);
  const scope = request.nextUrl.searchParams.get('scope') === 'say' ? 'say' : 'overlay';
  const presence = getActiveTtsConsumer(tenantId, scope);
  return apiOk({
    active: Boolean(presence),
    kind: presence?.kind || null,
    lastSeenAt: presence ? new Date(presence.lastSeenAt).toISOString() : null,
  });
}
