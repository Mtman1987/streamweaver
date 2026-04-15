import { NextResponse } from 'next/server';
import {
  getActionById,
  updateAction,
  deleteAction,
} from '@/lib/actions-store';
import { apiError, apiOk } from '@/lib/api-response';
import { z } from 'zod';

const updateActionSchema = z
  .object({
    name: z.string().trim().min(1).max(128).optional(),
    group: z.string().trim().max(128).optional(),
    enabled: z.boolean().optional(),
  })
  .strict();

export async function GET(
  _: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const action = await getActionById(id);
    if (!action) {
      return apiError('Not found.', { status: 404, code: 'NOT_FOUND' });
    }
    return apiOk(action);
  } catch (error: any) {
    return apiError(error?.message || 'Failed to load action.', { status: 500, code: 'INTERNAL_ERROR' });
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const parsed = updateActionSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return apiError('Invalid request body', { status: 400, code: 'INVALID_BODY' });
    }

    const payload = parsed.data;
    const updated = await updateAction(id, payload ?? {});
    if (!updated) {
      return apiError('Not found.', { status: 404, code: 'NOT_FOUND' });
    }
    return apiOk(updated);
  } catch (error: any) {
    return apiError(error?.message || 'Failed to update action.', { status: 500, code: 'INTERNAL_ERROR' });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const deleted = await deleteAction(id);
    if (!deleted) {
      return apiError('Not found.', { status: 404, code: 'NOT_FOUND' });
    }
    return apiOk({ success: true });
  } catch (error: any) {
    return apiError(error?.message || 'Failed to delete action.', { status: 500, code: 'INTERNAL_ERROR' });
  }
}
