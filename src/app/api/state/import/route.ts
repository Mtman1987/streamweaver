import { NextRequest } from 'next/server';
import { writeVault } from '@/lib/vault-store';
import { replaceAutomationVariables } from '@/lib/automation-variables-store';
import { replaceActions } from '@/lib/actions-store';
import { replaceCommands } from '@/lib/commands-store';
import { apiError, apiOk } from '@/lib/api-response';
import { getTenantFromRequest } from '@/lib/tenant-context';
import { z } from 'zod';

type ImportPayloadV1 = {
  version?: number;
  vault?: unknown;
  variables?: unknown;
  commands?: unknown;
  actions?: unknown;
};

const importPayloadSchema = z
  .object({
    version: z.number().optional(),
    vault: z.record(z.unknown()).optional(),
    variables: z.record(z.unknown()).optional(),
    commands: z.unknown().optional(),
    actions: z.unknown().optional(),
  })
  .passthrough();

function isRecord(value: unknown): value is Record<string, any> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function asImportArray(value: unknown, nestedKey: string): any[] {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      return asImportArray(JSON.parse(value), nestedKey);
    } catch {
      return [];
    }
  }
  if (isRecord(value) && Array.isArray(value[nestedKey])) {
    return value[nestedKey];
  }
  return [];
}

export async function POST(request: NextRequest) {
  try {
    const session = getTenantFromRequest(request);
    const tenantId = session?.tenantId;
    const parsed = importPayloadSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return apiError('Invalid JSON body', { status: 400, code: 'INVALID_BODY' });
    }

    const body = parsed.data as ImportPayloadV1;

    const mode = request.nextUrl.searchParams.get('mode') || 'replace';
    if (mode !== 'replace') {
      return apiError('Only mode=replace is supported', { status: 400, code: 'INVALID_MODE' });
    }

    const vault = body.vault;
    const variables = body.variables;
    const commands = body.commands;
    const actions = body.actions;
    const counts = {
      commands: 0,
      actions: 0,
    };

    // Replace is intentionally strict-ish: we only accept object shapes.
    if (vault !== undefined) {
      await writeVault(vault as any, tenantId);
    }

    if (variables !== undefined) {
      const global = isRecord((variables as any).global) ? (variables as any).global : {};
      const users = isRecord((variables as any).users) ? (variables as any).users : {};
      await replaceAutomationVariables({ global, users }, tenantId);
    }

    if (commands !== undefined) {
      counts.commands = await replaceCommands(asImportArray(commands, 'commands'), tenantId);
    }

    if (actions !== undefined) {
      counts.actions = await replaceActions(asImportArray(actions, 'actions'), tenantId);
    }

    return apiOk({ ok: true, imported: counts });
  } catch (error: any) {
    return apiError(String(error?.message || error), { status: 500, code: 'INTERNAL_ERROR' });
  }
}
