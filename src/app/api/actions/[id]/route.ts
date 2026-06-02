import { NextRequest } from 'next/server';
import {
  getActionById,
  updateAction,
  deleteAction,
} from '@/lib/actions-store';
import { apiError, apiOk } from '@/lib/api-response';
import { getTenantFromRequest } from '@/lib/tenant-context';
import { z } from 'zod';

const updateActionSchema = z
  .object({
    name: z.string().trim().min(1).max(128).optional(),
    group: z.string().trim().max(128).optional(),
    enabled: z.boolean().optional(),
    alwaysRun: z.boolean().optional(),
    randomAction: z.boolean().optional(),
    concurrent: z.boolean().optional(),
    excludeFromHistory: z.boolean().optional(),
    excludeFromPending: z.boolean().optional(),
    queue: z.string().trim().max(128).optional(),
    triggers: z.array(z.any()).optional(),
    subActions: z.array(z.any()).optional(),
  })
  .passthrough();

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = getTenantFromRequest(request);
    const action = await getActionById(id, session?.tenantId);
    if (!action) {
      return apiError('Not found.', { status: 404, code: 'NOT_FOUND' });
    }
    return apiOk(action);
  } catch (error: any) {
    return apiError(error?.message || 'Failed to load action.', { status: 500, code: 'INTERNAL_ERROR' });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = getTenantFromRequest(request);
    const parsed = updateActionSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return apiError('Invalid request body', { status: 400, code: 'INVALID_BODY' });
    }

    const payload = parsed.data;
    const updated = await updateAction(id, payload ?? {}, session?.tenantId);
    if (!updated) {
      return apiError('Not found.', { status: 404, code: 'NOT_FOUND' });
    }
    return apiOk(updated);
  } catch (error: any) {
    return apiError(error?.message || 'Failed to update action.', { status: 500, code: 'INTERNAL_ERROR' });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = getTenantFromRequest(request);
    const deleted = await deleteAction(id, session?.tenantId);
    if (!deleted) {
      return apiError('Not found.', { status: 404, code: 'NOT_FOUND' });
    }
    return apiOk({ success: true });
  } catch (error: any) {
    return apiError(error?.message || 'Failed to delete action.', { status: 500, code: 'INTERNAL_ERROR' });
  }
}
