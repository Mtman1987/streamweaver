import { NextRequest } from 'next/server';
import { deleteCommand, getCommandById, updateCommand } from '@/lib/commands-store';
import { apiError, apiOk } from '@/lib/api-response';
import { getTenantFromRequest } from '@/lib/tenant-context';
import { z } from 'zod';

const updateCommandSchema = z
  .object({
    name: z.string().trim().max(128).optional(),
    command: z.string().trim().max(128).optional(),
    group: z.string().trim().max(128).optional(),
    enabled: z.boolean().optional(),
    mode: z.number().optional(),
    regexExplicitCapture: z.boolean().optional(),
    location: z.number().optional(),
    ignoreBotAccount: z.boolean().optional(),
    ignoreInternal: z.boolean().optional(),
    sources: z.number().optional(),
    persistCounter: z.boolean().optional(),
    persistUserCounter: z.boolean().optional(),
    caseSensitive: z.boolean().optional(),
    globalCooldown: z.number().optional(),
    userCooldown: z.number().optional(),
    grantType: z.number().optional(),
    permittedUsers: z.array(z.string()).optional(),
    permittedGroups: z.array(z.string()).optional(),
    description: z.string().optional(),
    aliases: z.array(z.string()).optional(),
    permissions: z.array(z.string()).optional(),
    cooldown: z.object({ global: z.number().optional(), user: z.number().optional() }).optional(),
  })
  .passthrough();

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = getTenantFromRequest(request);
    const cmd = await getCommandById(id, session?.tenantId);
    if (!cmd) {
      return apiError('Not found.', { status: 404, code: 'NOT_FOUND' });
    }
    return apiOk(cmd);
  } catch (error: any) {
    return apiError(error?.message || 'Failed to load command.', { status: 500, code: 'INTERNAL_ERROR' });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = getTenantFromRequest(request);
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
      ...(body as any),
      name: body?.name != null ? String(body.name) : undefined,
      command: body?.command != null ? String(body.command) : undefined,
      group: body?.group != null ? String(body.group) : undefined,
      enabled: body?.enabled,
    }, session?.tenantId);

    if (!updated) {
      return apiError('Not found.', { status: 404, code: 'NOT_FOUND' });
    }

    return apiOk(updated);
  } catch (error: any) {
    return apiError(error?.message || 'Failed to update command.', { status: 500, code: 'INTERNAL_ERROR' });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = getTenantFromRequest(request);
    const deleted = await deleteCommand(id, session?.tenantId);
    if (!deleted) {
      return apiError('Not found.', { status: 404, code: 'NOT_FOUND' });
    }
    return apiOk({ success: true });
  } catch (error: any) {
    return apiError(error?.message || 'Failed to delete command.', { status: 500, code: 'INTERNAL_ERROR' });
  }
}
