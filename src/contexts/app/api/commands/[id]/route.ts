import { NextResponse } from 'next/server';
import { deleteCommand, getCommandById, updateCommand } from '@/lib/commands-store';
import { apiError, apiOk } from '@/lib/api-response';
import { z } from 'zod';

const updateCommandSchema = z
  .object({
    name: z.string().trim().max(128).optional(),
    command: z.string().trim().max(128).optional(),
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
    const cmd = await getCommandById(id);
    if (!cmd) {
      return apiError('Not found.', { status: 404, code: 'NOT_FOUND' });
    }
    return apiOk(cmd);
  } catch (error: any) {
    return apiError(error?.message || 'Failed to load command.', { status: 500, code: 'INTERNAL_ERROR' });
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const parsed = updateCommandSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return apiError('Invalid request body', { status: 400, code: 'INVALID_BODY' });
    }

    const body = parsed.data;

    if (body?.command != null) {
      const command = String(body.command).trim();
      if (!command.startsWith('!')) {
        return apiError('Command must start with !', { status: 400, code: 'INVALID_BODY' });
      }
    }

    const updated = await updateCommand(id, {
      name: body?.name != null ? String(body.name) : undefined,
      command: body?.command != null ? String(body.command) : undefined,
      group: body?.group != null ? String(body.group) : undefined,
      enabled: body?.enabled,
    });

    if (!updated) {
      return apiError('Not found.', { status: 404, code: 'NOT_FOUND' });
    }

    return apiOk(updated);
  } catch (error: any) {
    return apiError(error?.message || 'Failed to update command.', { status: 500, code: 'INTERNAL_ERROR' });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const deleted = await deleteCommand(id);
    if (!deleted) {
      return apiError('Not found.', { status: 404, code: 'NOT_FOUND' });
    }
    return apiOk({ success: true });
  } catch (error: any) {
    return apiError(error?.message || 'Failed to delete command.', { status: 500, code: 'INTERNAL_ERROR' });
  }
}
