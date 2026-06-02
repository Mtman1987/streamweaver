import { NextRequest, NextResponse } from 'next/server';
import { createCommand, getAllCommands, updateAllCommandsEnabled } from '@/lib/commands-store';
import { apiError } from '@/lib/api-response';
import { getTenantFromRequest } from '@/lib/tenant-context';
import { z } from 'zod';

const createCommandSchema = z.object({
  name: z.string().trim().max(128).optional(),
  command: z.string().trim().min(1, 'Command is required').max(128),
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
}).passthrough();

const bulkToggleSchema = z.object({
  enabled: z.boolean(),
});

export async function GET(request: NextRequest) {
  try {
    const session = getTenantFromRequest(request);
    const commands = await getAllCommands(session?.tenantId);
    return NextResponse.json(commands);
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'Failed to load commands.' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = getTenantFromRequest(request);
    const parsed = createCommandSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return apiError('Command is required', { status: 400, code: 'INVALID_BODY' });
    }

    const body = parsed.data;
    const name = (body?.name ?? '').toString().trim();
    const command = body.command;
    if (!command.startsWith('!')) {
      return apiError('Command must start with !', { status: 400, code: 'INVALID_BODY' });
    }
    const created = await createCommand({
      ...(body as any),
      name: name || command,
      command,
      group: body?.group,
      enabled: body?.enabled,
    }, session?.tenantId);
    return NextResponse.json(created);
  } catch (error: any) {
    return apiError(error?.message || 'Failed to create command.', { status: 500, code: 'INTERNAL_ERROR' });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const session = getTenantFromRequest(request);
    const parsed = bulkToggleSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return apiError('Enabled flag is required', { status: 400, code: 'INVALID_BODY' });
    }

    const updated = await updateAllCommandsEnabled(parsed.data.enabled, session?.tenantId);
    return NextResponse.json({ success: true, updated });
  } catch (error: any) {
    return apiError(error?.message || 'Failed to update commands.', { status: 500, code: 'INTERNAL_ERROR' });
  }
}
