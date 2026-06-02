import { NextRequest } from 'next/server';
import { apiError, apiOk } from '@/lib/api-response';
import { runActionById } from '@/lib/automation-runner';
import { getTenantFromRequest } from '@/lib/tenant-context';
import { z } from 'zod';

const runActionSchema = z
  .object({
    user: z.string().trim().max(128).optional(),
    userName: z.string().trim().max(128).optional(),
    message: z.string().max(1000).optional(),
    rawInput: z.string().max(1000).optional(),
    platform: z.string().trim().max(32).optional(),
    channel: z.string().trim().max(128).optional(),
    args: z.record(z.any()).optional(),
  })
  .passthrough();

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = getTenantFromRequest(request);
    const parsed = runActionSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return apiError('Invalid request body', { status: 400, code: 'INVALID_BODY' });
    }

    const result = await runActionById(id, session?.tenantId, parsed.data);
    return apiOk({
      success: result.success,
      actionId: result.action.id,
      actionName: result.action.name,
    });
  } catch (error: any) {
    const message = error?.message || 'Failed to run action.';
    const status = message.includes('not found') ? 404 : 500;
    return apiError(message, { status, code: status === 404 ? 'NOT_FOUND' : 'INTERNAL_ERROR' });
  }
}
