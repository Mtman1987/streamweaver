import { NextRequest } from 'next/server';
import { apiError, apiOk } from '@/lib/api-response';
import { runCommandById } from '@/lib/automation-runner';
import { getTenantFromRequest } from '@/lib/tenant-context';
import { z } from 'zod';

const runCommandSchema = z
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
    const parsed = runCommandSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return apiError('Invalid request body', { status: 400, code: 'INVALID_BODY' });
    }

    const result = await runCommandById(id, session?.tenantId, parsed.data);
    return apiOk({
      success: result.actionsFailed === 0,
      commandId: result.command.id,
      commandName: result.command.name,
      matchedActions: result.matchedActions,
      actionsRun: result.actionsRun,
      actionsFailed: result.actionsFailed,
    });
  } catch (error: any) {
    const message = error?.message || 'Failed to run command.';
    const status = message.includes('not found') ? 404 : message.includes('disabled') ? 409 : 500;
    return apiError(message, {
      status,
      code: status === 404 ? 'NOT_FOUND' : status === 409 ? 'COMMAND_DISABLED' : 'INTERNAL_ERROR',
    });
  }
}
