import { NextResponse } from 'next/server';
import { createCommand, getAllCommands } from '@/lib/commands-store';
import { apiError } from '@/lib/api-response';
import { z } from 'zod';

const createCommandSchema = z.object({
  name: z.string().trim().max(128).optional(),
  command: z.string().trim().min(1, 'Command is required').max(128),
  group: z.string().trim().max(128).optional(),
  enabled: z.boolean().optional(),
});

export async function GET() {
  try {
    const commands = await getAllCommands();
    return NextResponse.json(commands);
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'Failed to load commands.' },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
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
      name: name || command,
      command,
      group: body?.group,
      enabled: body?.enabled,
    });
    return NextResponse.json(created);
  } catch (error: any) {
    return apiError(error?.message || 'Failed to create command.', { status: 500, code: 'INTERNAL_ERROR' });
  }
}