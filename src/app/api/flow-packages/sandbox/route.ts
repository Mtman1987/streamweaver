import { NextRequest } from 'next/server';
import { ZodError } from 'zod';
import { apiError, apiOk } from '@/lib/api-response';
import { flowPackageSelectionSchema, parseFlowPackage } from '@/lib/flow-packages';
import { sandboxFlowPackage } from '@/lib/flow-package-sandbox';

function formatSandboxRequestError(error: unknown): string {
  if (error instanceof ZodError || Array.isArray((error as any)?.issues)) {
    return 'This preview only works with StreamWeaver flow packages. The selected item is missing flow package metadata; import Streamer.bot exports first or export it as a StreamWeaver Flow.';
  }
  const message = error instanceof Error ? error.message : '';
  if (message.includes('invalid_literal') || message.includes('streamweaver.flow-package')) {
    return 'This preview only works with StreamWeaver flow packages. The selected item is missing flow package metadata; import Streamer.bot exports first or export it as a StreamWeaver Flow.';
  }
  return message || 'Failed to run sandbox.';
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    const pkg = parseFlowPackage(body?.package);
    const selection = body?.selection ? flowPackageSelectionSchema.parse(body.selection) : undefined;
    const result = sandboxFlowPackage({
      package: pkg,
      selection,
      commandKey: body?.commandKey ? String(body.commandKey) : undefined,
      actionKey: body?.actionKey ? String(body.actionKey) : undefined,
      sandboxInput: body?.sandboxInput && typeof body.sandboxInput === 'object' ? body.sandboxInput : undefined,
    });
    return apiOk(result);
  } catch (error: any) {
    return apiError(formatSandboxRequestError(error), { status: 400, code: 'INVALID_SANDBOX_REQUEST' });
  }
}
