import { NextRequest } from 'next/server';
import { apiError, apiOk } from '@/lib/api-response';
import { getTenantFromRequest } from '@/lib/tenant-context';
import {
  applySharedChatOperatorAction,
  SharedChatOperatorActionSchema,
} from '@/services/shared-chat-operator-actions';
import { readSharedChatOperatorState } from '@/services/shared-chat-operator-state';

export async function GET(request: NextRequest) {
  const session = getTenantFromRequest(request);
  if (!session?.tenantId) {
    return apiError('Authentication required', { status: 401, code: 'UNAUTHORIZED' });
  }
  return apiOk({
    tenantId: session.tenantId,
    state: await readSharedChatOperatorState(session.tenantId),
  });
}

export async function POST(request: NextRequest) {
  const session = getTenantFromRequest(request);
  if (!session?.tenantId) {
    return apiError('Authentication required', { status: 401, code: 'UNAUTHORIZED' });
  }
  const parsed = SharedChatOperatorActionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return apiError('Invalid shared-chat operator action', { status: 400, code: 'INVALID_ACTION' });
  }

  try {
    const state = await applySharedChatOperatorAction(session.tenantId, parsed.data);
    return apiOk({ tenantId: session.tenantId, state });
  } catch (error: any) {
    return apiError(error?.message || 'Operator action failed', {
      status: error?.statusCode || 500,
      code: error?.code || 'OPERATOR_ACTION_FAILED',
    });
  }
}
